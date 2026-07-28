/**
 * The single-player path: a hub that belongs to one person on one machine.
 *
 * PartyCo is a coordination hub plus one executor per member, and that shape is right for a team
 * and absurd for the first ten minutes of a stranger's evening. Before this file the product could
 * not be opened at all without somebody first standing up a server and inventing an account on it —
 * a price nobody pays to try a desktop application, and the reason the whole thing was unusable by
 * anyone who had not built it.
 *
 * So the hub still exists and is still the only source of identity — nothing below weakens that —
 * but the desktop starts one on loopback for itself and mints the first session directly, because
 * **it owns the database file**. That is the entire security argument, and it is worth stating
 * plainly: a process that can open `hub.db` can already read every row in it, so requiring that
 * same process to also present a password proves nothing to anybody. Authority here comes from
 * filesystem access, which is the OS's answer, not ours to re-ask.
 *
 * What this deliberately is NOT:
 *
 *  - **Not a new HTTP route.** Nothing reachable over the socket changes. A remote hub is exactly as
 *    closed as it was, and no request can ask for a session it did not earn with a password.
 *  - **Not a stored credential.** The local account's password is generated, hashed, and dropped
 *    before this function returns. Nobody — not the member, not this code, not a later session —
 *    can ever produce it, so `POST /v1/auth/login` cannot open this account at all. There is no
 *    secret on disk to leak because there is no secret.
 *  - **Not a second kind of member.** The row is an ordinary member, made by the ordinary
 *    `registerMember`, so it gets the ordinary handle, colour and `owner` role by the ordinary
 *    rules. A local hub that later gains a second person through an invitation behaves like any
 *    other hub, because it *is* any other hub.
 */

import crypto from 'node:crypto';

import { createSession, publicMember, registerMember } from './auth.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('./db.js').MemberRow} MemberRow */

/**
 * The local account's address.
 *
 * `.invalid` is reserved by RFC 2606 precisely so that it can never resolve to a real mailbox, which
 * makes it the honest spelling of "this account has no email". A plausible-looking address would be
 * a lie the moment anybody tried to send to it, and the hub already promises it sends no mail.
 */
export const LOCAL_EMAIL = 'local@partyco.invalid';

/**
 * Find this machine's member, or make one, and open a session for them.
 *
 * Called by whoever started the hub, once per launch. Returns the same shape as registration and
 * login, so every caller downstream — the desktop bridge, the renderer's hub client, the panels —
 * handles one kind of session and cannot tell this one apart. That sameness is the point: a local
 * session that needed special cases would grow them everywhere.
 *
 * @param {DatabaseSync} db
 * @param {{ displayName?: unknown }} [options] `displayName` is a courtesy — the OS account name, so
 *   the greeting says something true on first launch. Ignored once the member exists: renaming
 *   somebody because their OS username changed is not this function's business.
 * @param {number} [now]
 * @returns {{ token: string, expiresAt: number, member: ReturnType<typeof publicMember> }}
 */
export function openLocalSession(db, options = {}, now = Date.now()) {
  const existing = /** @type {MemberRow | undefined} */ (
    db.prepare('SELECT * FROM member WHERE email = ?').get(LOCAL_EMAIL)
  );

  if (existing) {
    /*
     * A disabled local account would leave the person locked out of their own machine with no
     * screen able to explain why — there is no administrator here to appeal to, because they are
     * the administrator. Re-enabling is the only outcome that is not a dead end.
     */
    if (existing.disabled_at != null) {
      db.prepare('UPDATE member SET disabled_at = NULL WHERE id = ?').run(existing.id);
    }
    const session = createSession(db, existing.id, now);
    const row = /** @type {MemberRow} */ (
      db.prepare('SELECT * FROM member WHERE id = ?').get(existing.id)
    );
    return { token: session.token, expiresAt: session.expiresAt, member: publicMember(row) };
  }

  /*
   * A password that is generated here and never leaves this scope.
   *
   * The column is NOT NULL and `registerMember` validates what it is handed, so *something* has to
   * be passed. Making it 32 random bytes rather than a constant is what turns "the password is
   * unknown" into "the password does not exist": there is no value a future reader of this file
   * could type into the login form, and the hash it becomes is not a hash of anything anybody knows.
   */
  const unknowable = crypto.randomBytes(32).toString('base64url');

  const requested = typeof options.displayName === 'string' ? options.displayName.trim() : '';

  return registerMember(
    db,
    {
      email: LOCAL_EMAIL,
      password: unknowable,
      ...(requested.length > 0 ? { displayName: requested } : {}),
    },
    now,
  );
}
