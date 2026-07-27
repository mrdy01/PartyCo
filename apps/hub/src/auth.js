/**
 * Authentication for `partycod`: password hashing, session tokens, registration, login.
 *
 * Two rules in this file are load-bearing and should not be "simplified" later:
 *
 *  1. A password is only ever stored as a scrypt hash. There is no code path — not even a
 *     temporary or debug one — that writes a plaintext password to the database or to a log.
 *     Temporary versions live to see production.
 *  2. A wrong password and an unknown email produce the same status, the same code and the
 *     same amount of work. Otherwise the login form doubles as an oracle that enumerates
 *     which addresses are registered here.
 *
 * Provider credentials (Anthropic/OpenAI/Google keys) are NOT authentication material and
 * never touch this module or the database behind it.
 */

import crypto from 'node:crypto';

import { claimInvite, joinInviteProject, normalizeInviteCode, recordInviteUse } from './invites.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('./db.js').MemberRow} MemberRow */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * An error that is safe to show to a client: carries an HTTP status, a stable machine code
 * and a human Russian message. Anything thrown that is NOT an AuthError becomes a generic
 * 500 upstream — table names and stack traces never reach the wire.
 */
export class AuthError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message Russian, human, no internals.
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/**
 * scrypt cost parameters. N=2^15, r=8, p=1 — roughly 100 ms and 32 MiB per hash on a
 * typical VPS core, which is the point: it is the attacker's cost per guess if the file
 * ever leaks.
 */
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keylen: 32, saltBytes: 16 });

/**
 * scrypt needs 128 * N * r bytes ≈ 32 MiB here, and Node's DEFAULT maxmem is exactly
 * 32 MiB — so the call fails with "memory limit exceeded" unless maxmem is raised.
 * Discovered the hard way; do not drop this option.
 */
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

/** Serialised as `scrypt$N$r$p$<salt-base64>$<hash-base64>` — self-describing, so cost
 * parameters can be raised later without invalidating existing rows. */
const HASH_PREFIX = 'scrypt';

/**
 * @param {string} password
 * @param {Buffer} salt
 * @param {{ N: number, r: number, p: number, keylen: number }} params
 * @returns {Buffer}
 */
function derive(password, salt, params) {
  return crypto.scryptSync(password, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

/**
 * Hash a password for storage.
 * @param {string} password
 * @returns {string} `scrypt$32768$8$1$<salt-base64>$<hash-base64>`
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const hash = derive(password, salt, SCRYPT);
  return [
    HASH_PREFIX,
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Verify a password against a stored hash string.
 *
 * Returns false rather than throwing on a malformed stored value: a corrupt row must not
 * become a 500 that tells the caller the account exists.
 *
 * @param {string} password
 * @param {string} stored
 * @returns {boolean}
 */
export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual;
  try {
    actual = derive(password, salt, { N, r, p, keylen: expected.length });
  } catch {
    // Absurd stored parameters (N beyond maxmem, non power of two, ...) — treat as a
    // failed verification, not as a server fault.
    return false;
  }

  // Lengths are equal by construction (keylen = expected.length), but timingSafeEqual
  // throws on a mismatch, so guard rather than assume.
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * A real hash of a value nobody knows, verified against when the email is unknown so that
 * "no such account" costs the same scrypt run as "wrong password". Computed once at import
 * (~100 ms of startup), never compared successfully.
 */
const DECOY_HASH = hashPassword(crypto.randomBytes(32).toString('base64'));

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** 30 days, in milliseconds. Renewed on use. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How stale `last_seen_at` may get before an authenticated request writes to the database.
 * Without this every GET would be a write; with it the sliding window is still effectively
 * "30 days from last activity".
 */
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

/** Session token entropy: 32 bytes = 256 bits, base64url so it survives headers untouched. */
const TOKEN_BYTES = 32;

/**
 * @param {string} token
 * @returns {string} lowercase hex sha256
 */
export function tokenDigest(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Issue a session. Only the digest is persisted: a stolen database dump yields hashes, not
 * usable credentials. The plaintext token exists exactly once, in this return value.
 *
 * @param {DatabaseSync} db
 * @param {string} memberId
 * @param {number} [now]
 * @returns {{ token: string, expiresAt: number }}
 */
export function createSession(db, memberId, now = Date.now()) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare(
    'INSERT INTO session(token_sha256, member_id, created_at, expires_at, last_seen_at) VALUES(?, ?, ?, ?, ?)',
  ).run(tokenDigest(token), memberId, now, expiresAt, now);
  return { token, expiresAt };
}

/**
 * Resolve a bearer token to its member, renewing the session's expiry.
 *
 * Returns null for: unknown token, expired session, disabled member. The caller maps all
 * three to the same 401 — a client has no business learning which one it was.
 *
 * @param {DatabaseSync} db
 * @param {string|null|undefined} token
 * @param {number} [now]
 * @returns {MemberRow|null}
 */
export function resolveSession(db, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length === 0) return null;

  const digest = tokenDigest(token);
  const row = db
    .prepare(
      `SELECT s.token_sha256, s.expires_at, s.last_seen_at, m.*
         FROM session s JOIN member m ON m.id = s.member_id
        WHERE s.token_sha256 = ?`,
    )
    .get(digest);

  if (!row) return null;

  if (row.expires_at <= now) {
    db.prepare('DELETE FROM session WHERE token_sha256 = ?').run(digest);
    return null;
  }
  if (row.disabled_at != null) return null;

  if (now - Number(row.last_seen_at ?? 0) >= SESSION_TOUCH_INTERVAL_MS) {
    db.prepare('UPDATE session SET last_seen_at = ?, expires_at = ? WHERE token_sha256 = ?').run(
      now,
      now + SESSION_TTL_MS,
      digest,
    );
  }

  return /** @type {MemberRow} */ (row);
}

/**
 * Revoke one session. Idempotent — logging out twice is not an error.
 * @param {DatabaseSync} db
 * @param {string|null|undefined} token
 * @returns {boolean} whether a session was actually removed
 */
export function destroySession(db, token) {
  if (typeof token !== 'string' || token.length === 0) return false;
  return db.prepare('DELETE FROM session WHERE token_sha256 = ?').run(tokenDigest(token)).changes > 0;
}

// ---------------------------------------------------------------------------
// Identity: email, handle, colour, role
// ---------------------------------------------------------------------------

/**
 * The jewel palette, in assignment order. Mirrors `packages/tokens/src/palette.ts`
 * (IDENTITY_JEWEL) — duplicated as a literal on purpose: apps/hub is dependency-free plain
 * JS and must not import a TypeScript package from the UI workspace. If a slug is ever
 * added or renamed there, it has to be changed here too.
 *
 * A member's colour is assigned once, at registration, and is immutable afterwards: the
 * whole "who owns what at a glance" system rests on it. There is deliberately no code in
 * this file that updates `color_slug`.
 *
 * @type {readonly string[]}
 */
export const COLOR_SLUGS = Object.freeze([
  'teal',
  'rose',
  'violet',
  'indigo',
  'moss',
  'ochre',
]);

/**
 * Pick the least-occupied colour; ties break by the palette order above, so the first six
 * members get six distinct colours in a predictable sequence and the seventh starts the
 * second lap.
 *
 * @param {DatabaseSync} db
 * @returns {string}
 */
export function pickColorSlug(db) {
  const counts = new Map(COLOR_SLUGS.map((slug) => [slug, 0]));
  for (const row of db.prepare('SELECT color_slug, count(*) AS n FROM member GROUP BY color_slug').all()) {
    if (counts.has(row.color_slug)) counts.set(row.color_slug, Number(row.n));
  }
  let best = COLOR_SLUGS[0];
  for (const slug of COLOR_SLUGS) {
    if (counts.get(slug) < counts.get(best)) best = slug;
  }
  return best;
}

/**
 * Deliberately permissive: one `@`, something either side, a dot in the domain, no spaces.
 * Anything stricter rejects addresses that exist. Real verification is a confirmation mail,
 * which the owner has explicitly deferred.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** RFC 5321 caps an address at 254 octets; longer is malformed, not merely unusual. */
const EMAIL_MAX = 254;

/**
 * Case-fold and trim. The domain is case-insensitive by standard; the local part
 * technically is not, but every mail provider in practice treats it as such, and storing
 * the folded form is what makes the UNIQUE index mean "one account per address"
 * (SQLite's UNIQUE is byte-exact — without folding, Foo@x.io and foo@x.io are two accounts).
 *
 * @param {unknown} raw
 * @returns {string} normalised address
 * @throws {AuthError} 400 invalid_email
 */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') {
    throw new AuthError(400, 'invalid_email', 'Укажите почту.');
  }
  const email = raw.trim().toLowerCase();
  if (email.length === 0) {
    throw new AuthError(400, 'invalid_email', 'Укажите почту.');
  }
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    throw new AuthError(400, 'invalid_email', 'Это не похоже на адрес почты.');
  }
  return email;
}

/**
 * Upper bound only.
 *
 * There is no minimum length and no complexity rule — the owner asked for registration
 * "пока без проверок", and that decision is about validation. It does not extend to
 * storage: see hashPassword. When a password policy does arrive it goes here, and old
 * hashes stay valid because the stored string carries its own parameters.
 *
 * The cap exists because scrypt hashes whatever it is given: a 10 MB "password" would be
 * 10 MB of CPU per login attempt, from an unauthenticated caller.
 *
 * @param {unknown} raw
 * @returns {string}
 * @throws {AuthError} 400 invalid_password
 */
export function validatePassword(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AuthError(400, 'invalid_password', 'Придумайте пароль.');
  }
  if (Buffer.byteLength(raw, 'utf8') > 1024) {
    throw new AuthError(400, 'invalid_password', 'Пароль слишком длинный — не больше 1024 байт.');
  }
  return raw;
}

/**
 * Derive a handle from the local part of an email: lowercase, `[a-z0-9_-]`, collapsed
 * separators, 24 chars max. Collisions get a numeric suffix (`ann`, `ann-2`, `ann-3`).
 *
 * @param {DatabaseSync} db
 * @param {string} email normalised
 * @returns {string}
 */
export function deriveHandle(db, email) {
  const local = email.slice(0, email.indexOf('@'));
  let base = local
    .toLowerCase()
    .replace(/\+.*$/, '') // gmail-style tags are not part of the person's name
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  if (base.length === 0) base = 'member';

  const taken = db.prepare('SELECT 1 FROM member WHERE handle = ?');
  if (!taken.get(base)) return base;
  for (let i = 2; i < 10000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.get(candidate)) return candidate;
  }
  // Unreachable in a 2–10 person hub; still better than looping forever.
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Public shape of a member. `password_hash` is not in it, and must never be added:
 * this function is the only thing that builds member JSON, so the omission holds for
 * every endpoint at once.
 *
 * @param {MemberRow} row
 * @returns {{ id: string, email: string, handle: string, displayName: string, colorSlug: string, role: string, createdAt: number }}
 */
export function publicMember(row) {
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    colorSlug: row.color_slug,
    role: row.role,
    createdAt: Number(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Registration and login
// ---------------------------------------------------------------------------

/**
 * Register a member and open a session for them.
 *
 * The first account on a fresh hub becomes `owner`; everyone after is `member`, unless they
 * arrived with an invitation, in which case the role is the one the invitation promised.
 * Role, colour and the invitation's seat are all decided inside the same IMMEDIATE
 * transaction as the insert: two simultaneous first registrations cannot both come out
 * owner, and two people racing for the last seat of a five-seat code cannot both get in.
 *
 * An invitation code that is present but unusable fails the registration outright. Letting
 * it through "as an ordinary member" would silently ignore what the person was promised and
 * quietly grow the team past what its owner agreed to.
 *
 * An invitation that carries a project puts the new member into it inside the same
 * transaction, with the role the invitation promised: on the hub and in the project, or
 * neither.
 *
 * @param {DatabaseSync} db
 * @param {{ email: unknown, password: unknown, displayName?: unknown, inviteCode?: unknown }} input
 * @param {number} [now]
 * @returns {{ token: string, expiresAt: number, member: ReturnType<typeof publicMember> }}
 */
export function registerMember(db, input, now = Date.now()) {
  const email = normalizeEmail(input?.email);
  const password = validatePassword(input?.password);

  // Shape errors before the write lock; whether the code is still good is decided inside.
  const rawCode = input?.inviteCode;
  const inviteCode =
    rawCode == null || rawCode === '' ? null : normalizeInviteCode(rawCode);

  const requestedName = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
  // Hash before opening the transaction: scrypt takes ~100 ms and must not be held inside
  // a write lock on a single-writer database.
  const passwordHash = hashPassword(password);

  /** @type {{ id: string, session: { token: string, expiresAt: number } }} */
  let created;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM member WHERE email = ?').get(email)) {
      throw new AuthError(409, 'email_taken', 'На эту почту уже есть аккаунт.');
    }

    // Taking the seat before the insert, so an exhausted code stops the registration rather
    // than leaving a member the hub never agreed to admit.
    const invite = inviteCode ? claimInvite(db, inviteCode, now) : null;

    const handle = deriveHandle(db, email);
    const firstEver = db.prepare('SELECT count(*) AS n FROM member').get().n === 0;
    // An invitation cannot exist without a member who created it, so `firstEver` and
    // `invite` cannot both be true — the owner branch stays first regardless.
    const role = firstEver ? 'owner' : (invite?.role ?? 'member');
    const colorSlug = pickColorSlug(db);
    const displayName = requestedName.length > 0 ? requestedName.slice(0, 64) : handle;
    const id = crypto.randomUUID();

    db.prepare(
      `INSERT INTO member(id, email, password_hash, handle, display_name, color_slug, role, created_at, disabled_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(id, email, passwordHash, handle, displayName, colorSlug, role, now);

    // The ledger row comes after the member exists: invite_use.member_id is a foreign key
    // and SQLite checks it immediately.
    if (inviteCode) recordInviteUse(db, inviteCode, id, now);

    // An invitation into a project admits to both at once, in this same transaction. A
    // person who was promised a project and lands only on the hub would see an empty
    // application and no way to explain it, and nothing here would know they were owed
    // anything. `invite.role` and not `role`, because the owner branch above cannot be
    // reached with an invitation in hand.
    if (invite?.project_id != null) {
      joinInviteProject(db, invite.project_id, id, invite.role, now);
    }

    created = { id, session: createSession(db, id, now) };
    db.exec('COMMIT');
  } catch (err) {
    // COMMIT is the last statement in the try, so reaching here always means the
    // transaction is still open and ROLLBACK is valid.
    db.exec('ROLLBACK');
    // Lost a race against a concurrent registration of the same address: the UNIQUE index
    // is the real arbiter, the SELECT above is only the fast path.
    if (err instanceof Error && /UNIQUE constraint failed: member\.email/.test(err.message)) {
      throw new AuthError(409, 'email_taken', 'На эту почту уже есть аккаунт.');
    }
    throw err;
  }

  const row = /** @type {MemberRow} */ (db.prepare('SELECT * FROM member WHERE id = ?').get(created.id));
  return { token: created.session.token, expiresAt: created.session.expiresAt, member: publicMember(row) };
}

/**
 * Verify credentials and open a session.
 *
 * Unknown address and wrong password are indistinguishable by design — same 401, same
 * `invalid_credentials`, and the same single scrypt run (against DECOY_HASH when there is
 * no such member), so the response time does not answer "is this person registered here".
 * A disabled account takes the same path.
 *
 * @param {DatabaseSync} db
 * @param {{ email: unknown, password: unknown }} input
 * @param {number} [now]
 * @returns {{ token: string, expiresAt: number, member: ReturnType<typeof publicMember> }}
 */
export function login(db, input, now = Date.now()) {
  // Malformed input must not short-circuit into a different response than a wrong password,
  // or the shape of the request becomes the oracle instead of the timing.
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input?.password === 'string' ? input.password : '';

  const row = email
    ? /** @type {MemberRow|undefined} */ (db.prepare('SELECT * FROM member WHERE email = ?').get(email))
    : undefined;

  const usable = row && row.disabled_at == null;
  const ok = verifyPassword(password, usable ? row.password_hash : DECOY_HASH);

  if (!usable || !ok) {
    throw new AuthError(401, 'invalid_credentials', 'Неверная почта или пароль.');
  }

  const session = createSession(db, row.id, now);
  return { token: session.token, expiresAt: session.expiresAt, member: publicMember(row) };
}
