/**
 * hub.db — storage layer for `partycod`.
 *
 * SQLite via the built-in `node:sqlite` (Node >= 24, no flag, no native dependency).
 * Single writer, WAL journal — matches architecture.md §9.1 ("SQLite WAL, single writer").
 *
 * Scope note: this file owns ONLY the identity slice of hub.db — member, session, and the
 * invitations that let a second person into a hub (invite, invite_use). The rest of the
 * §9.1 schema (device, project, boundary, lane, claim, lease, ...) is not created here; it
 * will arrive as further migration steps. `member` below is the §9.1 table EXTENDED with the
 * three columns authentication needs — `email`, `password_hash`, `color_slug` — and with
 * NOT NULL constraints §9.1 leaves implicit.
 *
 * What is deliberately NOT here: model-provider credentials. The hub is a coordination plane.
 * Anthropic/OpenAI/Google keys never reach this database and must never be added to it.
 * A member's account password is a different thing — it authenticates against the hub itself,
 * so its (hashed) form belongs here.
 */

import { DatabaseSync } from 'node:sqlite';

/**
 * @typedef {object} MemberRow
 * @property {string} id
 * @property {string} email
 * @property {string} password_hash
 * @property {string} handle
 * @property {string} display_name
 * @property {string} color_slug
 * @property {'owner'|'maintainer'|'member'|'observer'} role
 * @property {number} created_at
 * @property {number|null} disabled_at
 */

/**
 * @typedef {object} SessionRow
 * @property {string} token_sha256
 * @property {string} member_id
 * @property {number} created_at
 * @property {number} expires_at
 * @property {number|null} last_seen_at
 */

/**
 * @typedef {object} InviteRow
 * @property {string} code normalised: upper case, no separators
 * @property {'maintainer'|'member'|'observer'} role
 * @property {string|null} email null = a code invitation rather than a mailed one
 * @property {string} created_by
 * @property {number} created_at
 * @property {number|null} expires_at null = lives until switched off
 * @property {number|null} max_uses null = as many people as come
 * @property {number} used_count
 * @property {number|null} revoked_at
 */

/**
 * @typedef {object} InviteUseRow
 * @property {string} code
 * @property {string} member_id
 * @property {number} used_at
 */

/**
 * Ordered, append-only list of migration steps.
 *
 * Rules that keep this honest:
 *   - a step that has shipped is never edited, only followed by a new step;
 *   - `version` is dense and ascending from 1;
 *   - every step runs inside one transaction together with the `schema_version` insert,
 *     so a crash mid-migration leaves the database at the previous version, not halfway.
 *
 * @type {ReadonlyArray<{ version: number, name: string, up: (db: DatabaseSync) => void }>}
 */
const MIGRATIONS = [
  {
    version: 1,
    name: 'member-and-session',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS member(
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          handle TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          color_slug TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner','maintainer','member','observer')),
          created_at INTEGER NOT NULL,
          disabled_at INTEGER);
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS session(
          token_sha256 TEXT PRIMARY KEY,
          member_id TEXT NOT NULL REFERENCES member(id),
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          last_seen_at INTEGER);
      `);

      // Colour assignment reads the per-slug population on every registration.
      db.exec('CREATE INDEX IF NOT EXISTS ix_member_color ON member(color_slug);');
      // Logout-everywhere and member deletion walk sessions by owner.
      db.exec('CREATE INDEX IF NOT EXISTS ix_session_member ON session(member_id);');
      // The expiry sweep is a range scan over this.
      db.exec('CREATE INDEX IF NOT EXISTS ix_session_expires ON session(expires_at);');
    },
  },
  {
    version: 2,
    name: 'invite-and-invite-use',
    up(db) {
      // `code` is the primary key in its NORMALISED form — upper case, no dashes — so the
      // lookup is byte-exact no matter how the guest typed it, and SQLite's implicit index
      // on the primary key is the index the /peek and /redeem paths need.
      //
      // `role` deliberately excludes 'owner': a hub has exactly one, it is whoever
      // registered first, and nothing in this service transfers it. A CHECK is a better
      // place for that rule than a comment in a handler.
      db.exec(`
        CREATE TABLE IF NOT EXISTS invite(
          code TEXT PRIMARY KEY,
          role TEXT NOT NULL CHECK(role IN ('maintainer','member','observer')),
          email TEXT,
          created_by TEXT NOT NULL REFERENCES member(id),
          created_at INTEGER NOT NULL,
          expires_at INTEGER,
          max_uses INTEGER,
          used_count INTEGER NOT NULL DEFAULT 0,
          revoked_at INTEGER);
      `);

      // Who took which seat, and when. The seat count in `invite.used_count` is the guard
      // that makes the last-seat race atomic; this table is the record that makes "1 из 5"
      // true. A counter without a ledger is a number that quietly drifts.
      //
      // PRIMARY KEY(code, member_id) is what makes redemption idempotent as an invariant of
      // the database rather than as a check some future handler might skip.
      db.exec(`
        CREATE TABLE IF NOT EXISTS invite_use(
          code TEXT NOT NULL REFERENCES invite(code),
          member_id TEXT NOT NULL REFERENCES member(id),
          used_at INTEGER NOT NULL,
          PRIMARY KEY(code, member_id));
      `);

      // The team panel lists invitations newest first.
      db.exec('CREATE INDEX IF NOT EXISTS ix_invite_created ON invite(created_at DESC);');
      // "Who did you invite" and cleanup after a member is removed.
      db.exec('CREATE INDEX IF NOT EXISTS ix_invite_created_by ON invite(created_by);');
      // Resending or cancelling an invitation starts from the address it was sent to.
      db.exec('CREATE INDEX IF NOT EXISTS ix_invite_email ON invite(email) WHERE email IS NOT NULL;');
      // "Which invitation let this person in" — the reverse of the ledger's primary key.
      db.exec('CREATE INDEX IF NOT EXISTS ix_invite_use_member ON invite_use(member_id);');
    },
  },
];

/** Highest migration version this build knows how to produce. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Read the applied schema version. 0 means "empty database".
 * @param {DatabaseSync} db
 * @returns {number}
 */
function currentVersion(db) {
  const row = db.prepare('SELECT max(version) AS v FROM schema_version').get();
  return Number(row?.v ?? 0);
}

/**
 * Apply every migration step newer than the stored version.
 * Idempotent: running it against an up-to-date database does nothing.
 *
 * @param {DatabaseSync} db
 * @returns {{ from: number, to: number, applied: string[] }}
 */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version(
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL);
  `);

  const from = currentVersion(db);
  if (from > SCHEMA_VERSION) {
    // The file was written by a newer partycod. Migrating down is not implemented and
    // guessing would corrupt data — refuse loudly instead.
    throw new Error(
      `hub.db has schema version ${from}, this build only knows ${SCHEMA_VERSION}. Upgrade partycod or restore an older backup.`,
    );
  }

  const applied = [];
  const record = db.prepare('INSERT INTO schema_version(version, name, applied_at) VALUES(?, ?, ?)');

  for (const step of MIGRATIONS) {
    if (step.version <= from) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      step.up(db);
      record.run(step.version, step.name, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    applied.push(`${step.version}:${step.name}`);
  }

  return { from, to: currentVersion(db), applied };
}

/**
 * Open (creating if absent) the hub database and bring it to the current schema.
 *
 * @param {string} path Filesystem path, or ':memory:' for an ephemeral database.
 * @returns {DatabaseSync}
 */
export function openDatabase(path) {
  const db = new DatabaseSync(path);

  // WAL survives across connections and is a property of the file, but setting it every
  // open is cheap and makes a restored/copied database behave the same as a fresh one.
  // :memory: silently stays in "memory" journal mode — that is fine and not worth branching on.
  db.exec('PRAGMA journal_mode = WAL;');
  // Durability compromise WAL makes safe: a power loss can lose the last transactions but
  // cannot corrupt the file. For a coordination hub that trade is the right one.
  db.exec('PRAGMA synchronous = NORMAL;');
  // session.member_id -> member.id is declared; without this pragma SQLite would not enforce it.
  db.exec('PRAGMA foreign_keys = ON;');
  // Single writer by design, but a concurrent backup or a stray reader should wait, not fail.
  db.exec('PRAGMA busy_timeout = 5000;');

  migrate(db);
  return db;
}

/**
 * Delete sessions whose expiry has passed. Called at startup and on a slow timer:
 * expired rows are already rejected on read, this only keeps the table from growing forever.
 *
 * @param {DatabaseSync} db
 * @param {number} [now]
 * @returns {number} rows removed
 */
export function purgeExpiredSessions(db, now = Date.now()) {
  return db.prepare('DELETE FROM session WHERE expires_at <= ?').run(now).changes;
}

/**
 * @param {DatabaseSync} db
 * @returns {number}
 */
export function countMembers(db) {
  return Number(db.prepare('SELECT count(*) AS n FROM member').get().n);
}
