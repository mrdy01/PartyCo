/**
 * Invitations for `partycod`: codes, seats, expiry, redemption.
 *
 * An invitation is the only way a second person gets into a hub, so three properties are
 * load-bearing here and must survive future edits:
 *
 *  1. **A code is a secret that gets read aloud.** The alphabet has no look-alikes and the
 *     generator draws from it without modulo bias, so `HTAK-4K7M-9ZQD` is 31^12 ≈ 2^59 wide
 *     and every code is equally likely. Shrinking the alphabet or reaching for `% 31` on a
 *     raw byte would quietly bias the first eight symbols.
 *  2. **Seats are counted in a ledger, not in a number.** `invite_use` records who redeemed
 *     what and when; `invite.used_count` exists only as the row-level guard that makes the
 *     "last seat" race atomic. "1 из 5" is read from the ledger, so it cannot drift.
 *  3. **`peek` answers the same thing to every dead code.** Expired, revoked, exhausted and
 *     never-existed are one answer, or the endpoint becomes an oracle that tells an
 *     unauthenticated guesser when a guess was *nearly* right.
 *
 * Dependency direction: this module imports nothing from `auth.js` (`auth.js` imports
 * `claimInvite` from here, and a cycle between the two would be a trap for whoever edits
 * them next). The consequence is that the email grammar is not owned here — the caller
 * passes an address already normalised by `auth.normalizeEmail`.
 *
 * The hub stays a coordination plane: an invitation grants a seat in the team, never access
 * to anyone's machine, files or provider keys.
 */

import crypto from 'node:crypto';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('./db.js').MemberRow} MemberRow */
/** @typedef {import('./db.js').InviteRow} InviteRow */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Client-safe failure: HTTP status, stable machine code, human Russian message.
 *
 * A twin of `AuthError` rather than an import of it: `auth.js` depends on this module, and
 * importing back would make the two files a cycle. Twelve duplicated lines are cheaper than
 * an import graph nobody dares to touch.
 */
export class InviteError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message Russian, human, no internals.
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'InviteError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

/**
 * The single answer for "this code will not let you in". Expired, revoked, exhausted and
 * unknown all produce it — the difference is not the caller's business, and telling them
 * would help a guesser more than it helps a guest.
 * @returns {InviteError}
 */
function inviteUnusable() {
  return new InviteError(
    400,
    'invite_invalid',
    'Код не подошёл — возможно, он уже истёк. Попроси новый у того, кто тебя позвал.',
  );
}

// ---------------------------------------------------------------------------
// The code
// ---------------------------------------------------------------------------

/**
 * Latin letters and digits with every look-alike removed — no `O`, no `0`, no `I`, no `L`,
 * no `1`. 31 symbols. A code is meant to survive being read aloud once, over a bad line.
 *
 * The same string is duplicated as `INVITE_CODE_ALPHABET` in
 * `packages/ui/src/components/AppShell/model.ts` (the UI workspace is TypeScript and this
 * service has no dependencies, so neither can import the other). The copies are checked
 * against each other by a test in `apps/hub/test.mjs` that reads that file as text — the
 * same trick `COLOR_SLUGS` uses against the palette.
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** `HTAK-4K7M-9ZQD` — three groups of four. */
export const INVITE_CODE_GROUPS = 3;
export const INVITE_CODE_GROUP_SIZE = 4;

/** 12 symbols stored, 14 characters displayed. */
export const INVITE_CODE_LENGTH = INVITE_CODE_GROUPS * INVITE_CODE_GROUP_SIZE;

/**
 * Largest multiple of the alphabet length that fits in a byte: 248 = 8 * 31.
 * Bytes at or above it are thrown away rather than folded, because 248..255 would map onto
 * `A`..`H` a ninth time and make the first eight symbols ~3% more likely than the rest.
 * The expected cost of that honesty is 256/248 ≈ 1.03 bytes per symbol.
 */
const UNBIASED_LIMIT = 256 - (256 % INVITE_CODE_ALPHABET.length);

/**
 * A fresh code, normalised form (12 symbols, no dashes).
 * @returns {string}
 */
export function generateInviteCode() {
  let out = '';
  while (out.length < INVITE_CODE_LENGTH) {
    // Over-draw: at ~3% rejection a 16-byte draw covers the remainder with room to spare,
    // and the loop re-draws if it somehow does not.
    for (const byte of crypto.randomBytes(16)) {
      if (byte >= UNBIASED_LIMIT) continue;
      out += INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length];
      if (out.length === INVITE_CODE_LENGTH) break;
    }
  }
  return out;
}

/**
 * Accept what a human typed and return the stored form, or refuse.
 *
 * Dashes and spaces are dropped, letters are upper-cased. Everything else must already be
 * in the alphabet — there are deliberately **no** "friendly" substitutions such as `0 → O`:
 * neither of those characters is in the alphabet, so a substitution would have nothing
 * correct to map onto, and guessing would silently turn one person's mistyped code into
 * somebody else's live one. A code that cannot be read is a question for the person who
 * sent it, not for us to answer by inventing.
 *
 * @param {unknown} raw
 * @returns {string} 12 symbols, upper case, no separators
 * @throws {InviteError} 400 invalid_code
 */
export function normalizeInviteCode(raw) {
  if (typeof raw !== 'string') {
    throw new InviteError(400, 'invalid_code', 'Введите код приглашения.');
  }
  const code = raw.replace(/[\s-]+/g, '').toUpperCase();
  if (code.length !== INVITE_CODE_LENGTH) {
    throw new InviteError(
      400,
      'invalid_code',
      `Код — это ${INVITE_CODE_GROUPS} группы по ${INVITE_CODE_GROUP_SIZE} знака.`,
    );
  }
  for (const ch of code) {
    if (!INVITE_CODE_ALPHABET.includes(ch)) {
      throw new InviteError(400, 'invalid_code', 'В коде есть знак, которого в кодах не бывает.');
    }
  }
  return code;
}

/**
 * Stored form → what a human sees and copies.
 * @param {string} code normalised
 * @returns {string} `HTAK-4K7M-9ZQD`
 */
export function formatInviteCode(code) {
  const groups = [];
  for (let i = 0; i < code.length; i += INVITE_CODE_GROUP_SIZE) {
    groups.push(code.slice(i, i + INVITE_CODE_GROUP_SIZE));
  }
  return groups.join('-');
}

/**
 * The link that goes into a message, a chat or a piece of paper.
 *
 * The hub itself does not serve `/join` — the desktop app does. This is a deep link the
 * invitee opens, and the only thing the hub contributes is the base URL an operator has
 * configured (`PARTYCOD_PUBLIC_URL`).
 *
 * @param {string} code normalised
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function joinUrl(code, baseUrl = '') {
  return `${String(baseUrl).replace(/\/+$/, '')}/join/${formatInviteCode(code)}`;
}

// ---------------------------------------------------------------------------
// Roles, lifetime, seats
// ---------------------------------------------------------------------------

/**
 * Roles an invitation may hand out. `owner` is not among them: a hub has exactly one, it is
 * whoever registered first, and no code in this service transfers it — so an invitation
 * offering it would be a promise the hub does not keep.
 * @type {readonly string[]}
 */
export const INVITABLE_ROLES = Object.freeze(['maintainer', 'member', 'observer']);

/** Who may create and revoke invitations. */
const INVITE_MANAGER_ROLES = Object.freeze(['owner', 'maintainer']);

/**
 * Rank used when a code is redeemed by an account that already exists. Redemption may
 * raise, never lower: otherwise handing someone an `observer` code would be a way to strip
 * a working teammate of their rights with one click.
 * @type {Record<string, number>}
 */
const ROLE_RANK = Object.freeze({ observer: 0, member: 1, maintainer: 2, owner: 3 });

/** How long a code lives, in milliseconds. `null` — until it is switched off by hand. */
export const INVITE_LIFETIME_MS = Object.freeze({
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  forever: null,
});

/** How many people one code lets in. `null` — as many as come. */
export const INVITE_SEAT_COUNT = Object.freeze({ one: 1, five: 5, any: null });

/**
 * @param {{ role?: string }|null|undefined} member
 * @returns {boolean}
 */
export function canManageInvites(member) {
  return !!member && INVITE_MANAGER_ROLES.includes(member.role ?? '');
}

/**
 * @param {{ role?: string }|null|undefined} member
 * @throws {InviteError} 403 forbidden
 */
function requireInviteManager(member) {
  if (!canManageInvites(member)) {
    throw new InviteError(403, 'forbidden', 'Звать в проект может хозяин хаба или мейнтейнер.');
  }
}

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/**
 * Status as the team panel says it. There are four, matching `InviteStatus` in the UI model:
 * a code that has used up its seats reads as `accepted` — it did its job — rather than as a
 * fifth state nothing renders.
 *
 * @param {InviteRow} row
 * @param {number} [now]
 * @returns {'pending'|'accepted'|'expired'|'revoked'}
 */
export function inviteStatus(row, now = Date.now()) {
  if (row.revoked_at != null) return 'revoked';
  if (row.max_uses != null && Number(row.used_count) >= Number(row.max_uses)) return 'accepted';
  if (row.expires_at != null && Number(row.expires_at) <= now) return 'expired';
  return 'pending';
}

/**
 * Is this code able to admit one more person right now?
 * @param {InviteRow} row
 * @param {number} [now]
 * @returns {boolean}
 */
function isLive(row, now = Date.now()) {
  return inviteStatus(row, now) === 'pending';
}

/**
 * JSON form of an invitation. Built in one place so that a redaction rule holds on every
 * endpoint at once, the way `publicMember` holds the "no password_hash" rule.
 *
 * @param {InviteRow & { use_ledger?: number }} row
 * @param {{ joinBaseUrl?: string, redactCode?: boolean }} [options]
 * @param {number} [now]
 */
export function publicInvite(row, options = {}, now = Date.now()) {
  const { joinBaseUrl = '', redactCode = false } = options;
  return {
    // A live code is a credential. Someone who may see the list but may not hand out seats
    // gets the row without it — see listInvites.
    code: redactCode ? null : formatInviteCode(row.code),
    joinUrl: redactCode ? null : joinUrl(row.code, joinBaseUrl),
    channel: row.email ? 'email' : 'code',
    email: row.email ?? null,
    role: row.role,
    status: inviteStatus(row, now),
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    // `used_count` is the concurrency guard; the ledger is the truth. They agree, and when
    // a future bug makes them disagree the number a human reads is the one from the ledger.
    usedCount: Number(row.use_ledger ?? row.used_count),
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
  };
}

/** `SELECT` that carries the ledger count alongside the row. */
const SELECT_WITH_LEDGER =
  'SELECT i.*, (SELECT count(*) FROM invite_use u WHERE u.code = i.code) AS use_ledger FROM invite i';

// ---------------------------------------------------------------------------
// Create, list, revoke
// ---------------------------------------------------------------------------

/**
 * Create an invitation.
 *
 * @param {DatabaseSync} db
 * @param {MemberRow} actor session owner; must be owner or maintainer
 * @param {{ role?: unknown, email?: unknown, lifetime?: unknown, seats?: unknown }} input
 * @param {{ joinBaseUrl?: string, normalizeEmail?: (raw: unknown) => string }} [options]
 *   `normalizeEmail` is handed in rather than imported: the email grammar belongs to
 *   `auth.js`, which depends on this module, and reaching back would make a cycle.
 * @param {number} [now]
 * @returns {ReturnType<typeof publicInvite>}
 */
export function createInvite(db, actor, input, options = {}, now = Date.now()) {
  // Authorisation before validation: otherwise an observer who may not invite anyone still
  // learns from the answer whether an address parses.
  requireInviteManager(actor);

  const role = input?.role;
  if (role === 'owner') {
    throw new InviteError(
      400,
      'invalid_role',
      'Хозяин хаба один — им становится тот, кто зарегистрировался первым. Эту роль не раздают.',
    );
  }
  if (typeof role !== 'string' || !INVITABLE_ROLES.includes(role)) {
    throw new InviteError(400, 'invalid_role', 'Выберите роль: мейнтейнер, участник или только смотрит.');
  }

  const rawEmail = input?.email;
  const email =
    rawEmail == null || rawEmail === ''
      ? null
      : options.normalizeEmail
        ? options.normalizeEmail(rawEmail)
        : String(rawEmail);

  // Defaults follow the invite panel's pre-selected tabs, with one exception: an invitation
  // addressed to one person defaults to one seat, because that is what it says on the tin.
  const lifetimeKey = input?.lifetime ?? 'day';
  const seatsKey = input?.seats ?? (email ? 'one' : 'five');

  if (typeof lifetimeKey !== 'string' || !(lifetimeKey in INVITE_LIFETIME_MS)) {
    throw new InviteError(400, 'invalid_lifetime', 'Срок жизни кода — сутки, неделя или «пока не отключу».');
  }
  if (typeof seatsKey !== 'string' || !(seatsKey in INVITE_SEAT_COUNT)) {
    throw new InviteError(400, 'invalid_seats', 'Код пускает одного, пятерых или сколько угодно.');
  }

  const ttl = INVITE_LIFETIME_MS[/** @type {keyof typeof INVITE_LIFETIME_MS} */ (lifetimeKey)];
  const expiresAt = ttl == null ? null : now + ttl;
  const maxUses = INVITE_SEAT_COUNT[/** @type {keyof typeof INVITE_SEAT_COUNT} */ (seatsKey)];

  const insert = db.prepare(
    `INSERT INTO invite(code, role, email, created_by, created_at, expires_at, max_uses, used_count, revoked_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
  );

  // A collision is ~2^-59 per attempt; retrying twice costs nothing and turns "astronomically
  // unlikely" into "cannot happen", which is a better thing to be able to say.
  let code = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    code = generateInviteCode();
    try {
      insert.run(code, role, email, actor.id, now, expiresAt, maxUses);
      break;
    } catch (err) {
      const collided = err instanceof Error && /UNIQUE constraint failed: invite\.code/.test(err.message);
      if (!collided || attempt === 2) throw err;
    }
  }

  const row = /** @type {InviteRow} */ (db.prepare('SELECT * FROM invite WHERE code = ?').get(code));
  return publicInvite(row, { joinBaseUrl: options.joinBaseUrl ?? '' }, now);
}

/**
 * Every invitation, newest first, for the team panel.
 *
 * Any signed-in member may see that invitations exist and what became of them. Only owners
 * and maintainers see the codes themselves: a live code is a seat in the team, and an
 * observer who could read one could hand out a maintainer's rights.
 *
 * @param {DatabaseSync} db
 * @param {MemberRow} actor
 * @param {{ joinBaseUrl?: string }} [options]
 * @param {number} [now]
 * @returns {Array<ReturnType<typeof publicInvite>>}
 */
export function listInvites(db, actor, options = {}, now = Date.now()) {
  const redactCode = !canManageInvites(actor);
  const rows = db.prepare(`${SELECT_WITH_LEDGER} ORDER BY i.created_at DESC, i.code`).all();
  return rows.map((row) =>
    publicInvite(
      /** @type {InviteRow & { use_ledger?: number }} */ (row),
      { joinBaseUrl: options.joinBaseUrl ?? '', redactCode },
      now,
    ),
  );
}

/**
 * Switch a code off. Idempotent: revoking an already-revoked invitation is a success, not an
 * error, so a client that lost the response can simply repeat itself.
 *
 * @param {DatabaseSync} db
 * @param {MemberRow} actor
 * @param {unknown} rawCode
 * @param {{ joinBaseUrl?: string }} [options]
 * @param {number} [now]
 * @returns {ReturnType<typeof publicInvite>}
 */
export function revokeInvite(db, actor, rawCode, options = {}, now = Date.now()) {
  requireInviteManager(actor);
  const code = normalizeInviteCode(rawCode);

  db.prepare('UPDATE invite SET revoked_at = ? WHERE code = ? AND revoked_at IS NULL').run(now, code);

  const row = db.prepare(`${SELECT_WITH_LEDGER} WHERE i.code = ?`).get(code);
  if (!row) {
    // Not the idempotency case — there is nothing here and never was. Managers already know
    // which codes exist, so this answer leaks nothing they cannot read from the list.
    throw new InviteError(404, 'invite_not_found', 'Такого приглашения нет.');
  }
  return publicInvite(
    /** @type {InviteRow & { use_ledger?: number }} */ (row),
    { joinBaseUrl: options.joinBaseUrl ?? '' },
    now,
  );
}

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

/**
 * The look-before-you-leap answer for someone who has a code and no account yet.
 *
 * Deliberately minimal: whether it works, and what it would make them. Nothing about who
 * invited them, nothing about who is already in the team — this is the one endpoint that
 * takes a guessable secret without a session, and everything it says is said to whoever
 * guessed. Every unusable code — expired, revoked, exhausted, malformed, never existed —
 * produces the identical body, so the endpoint cannot be used to sort guesses.
 *
 * @param {DatabaseSync} db
 * @param {unknown} rawCode
 * @param {{ projectName?: string|null }} [options]
 * @param {number} [now]
 * @returns {{ valid: boolean, role?: string, projectName?: string }}
 */
export function peekInvite(db, rawCode, options = {}, now = Date.now()) {
  /** @type {string} */
  let code;
  try {
    code = normalizeInviteCode(rawCode);
  } catch {
    return { valid: false };
  }

  const row = /** @type {InviteRow|undefined} */ (db.prepare('SELECT * FROM invite WHERE code = ?').get(code));
  if (!row || !isLive(row, now)) return { valid: false };

  /** @type {{ valid: boolean, role?: string, projectName?: string }} */
  const answer = { valid: true, role: row.role };
  if (options.projectName) answer.projectName = options.projectName;
  return answer;
}

/**
 * Take one seat. **Must be called inside an open transaction** — for registration that is
 * the same transaction as the member insert, so two people racing for the last seat of a
 * five-seat code cannot both win it.
 *
 * The conditional UPDATE is the gate, not the SELECT above it: `used_count < max_uses` is
 * evaluated by the database while it holds the write lock, and `changes === 0` means
 * somebody else got there first.
 *
 * The ledger row is written separately by `recordInviteUse` after the member exists —
 * `invite_use.member_id` is a foreign key, and SQLite checks it immediately.
 *
 * @param {DatabaseSync} db
 * @param {string} code normalised
 * @param {number} [now]
 * @returns {InviteRow} the invitation as it was before this claim
 * @throws {InviteError} 400 invite_invalid
 */
export function claimInvite(db, code, now = Date.now()) {
  const row = /** @type {InviteRow|undefined} */ (db.prepare('SELECT * FROM invite WHERE code = ?').get(code));
  if (!row) throw inviteUnusable();

  const changed = db
    .prepare(
      `UPDATE invite SET used_count = used_count + 1
        WHERE code = ?
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
          AND (max_uses IS NULL OR used_count < max_uses)`,
    )
    .run(code, now).changes;

  if (changed !== 1) throw inviteUnusable();
  return row;
}

/**
 * Write the ledger row for a claim. Same transaction as `claimInvite`, after the member row
 * exists.
 *
 * @param {DatabaseSync} db
 * @param {string} code normalised
 * @param {string} memberId
 * @param {number} [now]
 */
export function recordInviteUse(db, code, memberId, now = Date.now()) {
  db.prepare('INSERT INTO invite_use(code, member_id, used_at) VALUES(?, ?, ?)').run(code, memberId, now);
}

/**
 * Redeem a code with an account that already exists.
 *
 * Idempotent by the shape of the table, not by a check that could be forgotten:
 * `invite_use` is keyed on (code, member_id), so a second redemption by the same person
 * finds their own row and returns without touching the counter — "1 из 5" stays 1.
 *
 * A redemption may raise the member's role and never lowers it. Lowering would turn a code
 * into a weapon: hand a maintainer an `observer` invitation and watch them demote
 * themselves. The owner is never touched at all.
 *
 * @param {DatabaseSync} db
 * @param {MemberRow} member
 * @param {unknown} rawCode
 * @param {{ joinBaseUrl?: string }} [options]
 * @param {number} [now]
 * @returns {{ member: MemberRow, invite: ReturnType<typeof publicInvite>, alreadyRedeemed: boolean }}
 */
export function redeemInvite(db, member, rawCode, options = {}, now = Date.now()) {
  const code = normalizeInviteCode(rawCode);

  /** @type {{ alreadyRedeemed: boolean }} */
  let outcome;

  db.exec('BEGIN IMMEDIATE');
  try {
    const mine = db
      .prepare('SELECT used_at FROM invite_use WHERE code = ? AND member_id = ?')
      .get(code, member.id);

    if (mine) {
      outcome = { alreadyRedeemed: true };
    } else {
      const claimed = claimInvite(db, code, now);
      recordInviteUse(db, code, member.id, now);

      const current = ROLE_RANK[member.role] ?? 0;
      const offered = ROLE_RANK[claimed.role] ?? 0;
      if (member.role !== 'owner' && offered > current) {
        db.prepare('UPDATE member SET role = ? WHERE id = ?').run(claimed.role, member.id);
      }
      outcome = { alreadyRedeemed: false };
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const row = /** @type {MemberRow} */ (db.prepare('SELECT * FROM member WHERE id = ?').get(member.id));
  const invite = /** @type {InviteRow & { use_ledger?: number }} */ (
    db.prepare(`${SELECT_WITH_LEDGER} WHERE i.code = ?`).get(code)
  );
  return {
    member: row,
    invite: publicInvite(invite, { joinBaseUrl: options.joinBaseUrl ?? '' }, now),
    alreadyRedeemed: outcome.alreadyRedeemed,
  };
}
