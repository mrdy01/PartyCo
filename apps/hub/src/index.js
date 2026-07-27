/**
 * `partycod` — the PartyCo coordination hub daemon.
 *
 * Entry point: reads configuration from the environment, opens hub.db, wires the routes
 * and listens. Zero runtime dependencies — `node:http`, `node:crypto`, `node:sqlite`.
 * Every dependency here is something the owner would have to patch on their own VPS at
 * 2am, so there are none.
 *
 * The hub is a coordination plane and holds no model-provider credentials. Account
 * passwords (hashed) and session tokens (hashed) are the only secrets in its database.
 *
 * Run:      node apps/hub/src/index.js
 * Env:      PARTYCOD_DB, PARTYCOD_PORT, PARTYCOD_HOST, PARTYCOD_ORIGINS,
 *           PARTYCOD_TRUST_PROXY, PARTYCOD_RATE_LIMIT, PARTYCOD_RATE_WINDOW_MS,
 *           PARTYCOD_PUBLIC_URL, PARTYCOD_SMTP_URL
 *
 * PARTYCOD_PROJECT_NAME is gone. It existed because `GET /v1/invites/peek` had to name a
 * project before the `project` table did, so one string stood for the whole installation and
 * nothing could check it. The name now comes from the project the invitation is written for.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { openDatabase, countMembers, purgeExpiredSessions, SCHEMA_VERSION } from './db.js';
import {
  registerMember,
  login,
  resolveSession,
  destroySession,
  publicMember,
  normalizeEmail,
  AuthError,
} from './auth.js';
import {
  createInvite,
  listInvites,
  revokeInvite,
  peekInvite,
  redeemInvite,
  canManageInvites,
} from './invites.js';
import {
  createProject,
  listProjects,
  listProjectMembers,
  addProjectMember,
  resolveInviteProject,
} from './projects.js';
import { createHttpServer, parseOrigins, createRateLimiter, HttpError } from './http.js';

/** Wire protocol version. Bumped when the shape of these responses changes incompatibly. */
export const PROTOCOL_VERSION = 1;

export const DEFAULT_PORT = 7717;

/** Read once, from the manifest, so `/v1/health` cannot drift from the package. */
const VERSION = (() => {
  try {
    const manifest = fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8');
    return String(JSON.parse(manifest).version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
})();

/** Sessions are rejected on read once expired; this only stops the table from growing. */
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Require a live session, or fail with the one 401 the API defines.
 * Unknown token, expired session and disabled account are deliberately the same answer.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ token: string|null }} ctx
 * @returns {import('./db.js').MemberRow}
 */
function requireMember(db, ctx) {
  const member = resolveSession(db, ctx.token);
  if (!member) {
    throw new AuthError(401, 'unauthorized', 'Нужно войти заново.');
  }
  return member;
}

/**
 * Start the hub.
 *
 * Exported (rather than only run) so tests can bring up a real server on an ephemeral port
 * against a temporary database — the test exercises the same wiring production uses.
 *
 * @param {object} [options]
 * @param {string} [options.dbPath]
 * @param {number} [options.port] 0 picks a free port
 * @param {string} [options.host]
 * @param {string[]|null} [options.origins]
 * @param {boolean} [options.trustProxy]
 * @param {{ limit?: number, windowMs?: number }} [options.rateLimit]
 * @param {string|null} [options.publicUrl] base of the join link handed to invitees
 * @param {string|null} [options.smtpUrl] presence alone; the hub sends no mail yet
 * @param {(msg: string) => void} [options.log]
 * @returns {Promise<{ server: import('node:http').Server, db: import('node:sqlite').DatabaseSync, port: number, host: string, url: string, close: () => Promise<void> }>}
 */
export async function startHub(options = {}) {
  const {
    dbPath = './hub.db',
    port = DEFAULT_PORT,
    host = '127.0.0.1',
    origins = null,
    trustProxy = false,
    rateLimit = {},
    publicUrl = null,
    smtpUrl = null,
    log = () => {},
  } = options;

  const db = openDatabase(dbPath);
  purgeExpiredSessions(db);

  // Base of the `…/join/HTAK-4K7M-9ZQD` link. An operator behind a TLS terminator sets
  // PARTYCOD_PUBLIC_URL; without it the best we honestly know is where we are listening,
  // filled in below once the port is real.
  let joinBaseUrl = typeof publicUrl === 'string' ? publicUrl.replace(/\/+$/, '') : '';
  const inviteOptions = () => ({ joinBaseUrl });

  // One bucket per IP shared by /register and /login: both are password-guessing surfaces,
  // and letting an attacker get 10 tries on each would just double the budget.
  const limiter = createRateLimiter(rateLimit);

  /** @param {{ ip: string }} ctx */
  function enforceRateLimit(ctx) {
    const verdict = limiter.check(ctx.ip);
    if (!verdict.allowed) {
      const err = new HttpError(429, 'rate_limited', 'Слишком много попыток. Подождите минуту.');
      err.headers = { 'retry-after': String(verdict.retryAfterSec) };
      throw err;
    }
  }

  const routes = {
    'GET /v1/health': () => ({
      status: 200,
      body: {
        name: 'partycod',
        version: VERSION,
        protocol: PROTOCOL_VERSION,
        members: countMembers(db),
      },
    }),

    'POST /v1/auth/register': async (ctx) => {
      enforceRateLimit(ctx);
      const input = await ctx.body();
      const result = registerMember(db, input);
      return { status: 201, body: result };
    },

    'POST /v1/auth/login': async (ctx) => {
      enforceRateLimit(ctx);
      const input = await ctx.body();
      const result = login(db, input);
      return { status: 200, body: result };
    },

    'GET /v1/auth/me': (ctx) => ({
      status: 200,
      body: { member: publicMember(requireMember(db, ctx)) },
    }),

    'POST /v1/auth/logout': (ctx) => {
      // Idempotent: 204 whether or not the token was live, so a client can always clear
      // its own state without branching. No bearer at all is still an unauthorized call.
      requireMember(db, ctx);
      destroySession(db, ctx.token);
      return { status: 204 };
    },

    'GET /v1/members': (ctx) => {
      const actor = requireMember(db, ctx);
      // Addresses are the one field here that is not the team's shared business. A member
      // or an observer sees their own and nobody else's: otherwise any account on the hub
      // is a one-request export of everyone's email.
      const showEmails = canManageInvites(actor);
      const rows = db.prepare('SELECT * FROM member ORDER BY created_at, id').all();
      return {
        status: 200,
        body: {
          members: rows.map((row) => {
            const member = publicMember(/** @type {import('./db.js').MemberRow} */ (row));
            return showEmails || member.id === actor.id ? member : { ...member, email: null };
          }),
        },
      };
    },

    'POST /v1/invites': async (ctx) => {
      const actor = requireMember(db, ctx);
      const input = await ctx.body();
      // The email grammar has exactly one owner — auth.js — and is lent to invites.js here
      // rather than imported there, so the two modules stay a straight line and not a cycle.
      // The project rules travel the same way, and `createInvite` calls this only after it
      // has refused everyone who may not invite: otherwise the answer would tell an observer
      // whether a project id is real before telling them they may not invite anybody.
      const invite = createInvite(db, actor, input, {
        ...inviteOptions(),
        normalizeEmail,
        resolveProject: (rawProjectId) => resolveInviteProject(db, actor, rawProjectId),
      });

      // Never claim a letter went out. No SMTP client ships in this service — that would be
      // a dependency — so `mailSent` is false in every branch that exists today, and
      // `mailPending` says only that an operator has configured a route we do not use yet.
      // TODO: with PARTYCOD_SMTP_URL set, actually deliver the invitation and set mailSent.
      return {
        status: 201,
        body: {
          invite,
          joinUrl: invite.joinUrl,
          mailSent: false,
          mailPending: Boolean(smtpUrl) && invite.channel === 'email',
        },
      };
    },

    'GET /v1/invites': (ctx) => ({
      status: 200,
      body: { invites: listInvites(db, requireMember(db, ctx), inviteOptions()) },
    }),

    'POST /v1/invites/revoke': async (ctx) => {
      const actor = requireMember(db, ctx);
      const input = await ctx.body();
      return { status: 200, body: { invite: revokeInvite(db, actor, input.code, inviteOptions()) } };
    },

    'POST /v1/invites/redeem': async (ctx) => {
      const actor = requireMember(db, ctx);
      const input = await ctx.body();
      const result = redeemInvite(db, actor, input.code, inviteOptions());
      return {
        status: 200,
        body: {
          member: publicMember(result.member),
          invite: result.invite,
          alreadyRedeemed: result.alreadyRedeemed,
        },
      };
    },

    // The only unauthenticated endpoint that takes a guessable secret, so it shares the
    // password-guessing budget with /register and /login. It answers identically for every
    // code that will not work, which is what keeps it from sorting an attacker's guesses.
    // The project name it may return is the one on that invitation's own row — a fact its
    // author disclosed by handing the code out — and never a name from anywhere else.
    'GET /v1/invites/peek': (ctx) => {
      enforceRateLimit(ctx);
      return { status: 200, body: peekInvite(db, ctx.url.searchParams.get('code')) };
    },

    'GET /v1/projects': (ctx) => ({
      status: 200,
      body: { projects: listProjects(db, requireMember(db, ctx)) },
    }),

    'POST /v1/projects': async (ctx) => {
      const actor = requireMember(db, ctx);
      const input = await ctx.body();
      return { status: 201, body: { project: createProject(db, actor, input) } };
    },

    // The router matches `"METHOD /path"` exactly and has no path parameters, so the project
    // travels in the query string rather than as `/v1/projects/:id/members`. Teaching the
    // router about parameters would mean rewriting the lookup, the 405 table and the
    // preflight's Allow header — three things every existing endpoint depends on — for a
    // prettier URL. `?projectId=` is the honest shape of what this router can do.
    'GET /v1/projects/members': (ctx) => {
      const actor = requireMember(db, ctx);
      return {
        status: 200,
        body: listProjectMembers(db, actor, ctx.url.searchParams.get('projectId'), {
          // Addresses are hidden by HUB role, exactly as in `GET /v1/members` above.
          // Deciding by project role instead would let anyone create a project, add the
          // team to it and read every address the other endpoint refuses to show them.
          showEmails: canManageInvites(actor),
        }),
      };
    },

    'POST /v1/projects/members': async (ctx) => {
      const actor = requireMember(db, ctx);
      const input = await ctx.body();
      const result = addProjectMember(db, actor, input, { showEmails: canManageInvites(actor) });
      // 201 when a row appeared, 200 when the same call had already succeeded — the flag in
      // the body says which, so a client that retries never has to guess.
      return { status: result.alreadyMember ? 200 : 201, body: result };
    },
  };

  const server = createHttpServer({ routes, origins, trustProxy, logError: log });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(undefined);
    });
  });

  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  const actualPort = address.port;
  const listeningUrl = `http://${host.includes(':') ? `[${host}]` : host}:${actualPort}`;
  // No PARTYCOD_PUBLIC_URL: a join link to where we actually listen is useless outside this
  // machine, but it is true, and a truthful useless link beats a plausible wrong one.
  if (joinBaseUrl === '') joinBaseUrl = listeningUrl;
  const sweep = setInterval(() => purgeExpiredSessions(db), SESSION_SWEEP_INTERVAL_MS);
  sweep.unref();

  let closed = false;
  /**
   * Stop accepting, let in-flight requests finish, then close the database.
   * @param {{ graceMs?: number }} [opts]
   */
  async function close({ graceMs = 3000 } = {}) {
    if (closed) return;
    closed = true;
    clearInterval(sweep);
    const drained = new Promise((resolve) => server.close(() => resolve(undefined)));
    // Keep-alive sockets sitting idle would otherwise hold the close open for their full
    // timeout; sockets with a request in flight get `graceMs` to finish before being cut.
    server.closeIdleConnections?.();
    const cutoff = setTimeout(() => server.closeAllConnections?.(), graceMs);
    cutoff.unref();
    await drained;
    clearTimeout(cutoff);
    db.close();
  }

  return {
    server,
    db,
    port: actualPort,
    host,
    url: listeningUrl,
    close,
  };
}

/**
 * Parse a non-negative integer from the environment.
 * An unset OR empty variable falls back — `Number('')` is 0, which would silently turn
 * `PARTYCOD_PORT=` into "listen on a random port".
 *
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function intFromEnv(raw, fallback) {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Read the environment and start. Only used when this file is the process entry point. */
async function main() {
  const dbPath = process.env.PARTYCOD_DB || './hub.db';
  const port = intFromEnv(process.env.PARTYCOD_PORT, DEFAULT_PORT);
  // Loopback by default: a hub that binds every interface the moment it is installed is a
  // plain-HTTP login form on the public internet. Opening it is an explicit act.
  const host = process.env.PARTYCOD_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
  const origins = parseOrigins(process.env.PARTYCOD_ORIGINS);
  const trustProxy = process.env.PARTYCOD_TRUST_PROXY === '1';
  const publicUrl = process.env.PARTYCOD_PUBLIC_URL || null;
  // Presence only. The hub sends no mail; this flag makes the API say "an operator has
  // configured a route" instead of pretending a letter went out.
  const smtpUrl = process.env.PARTYCOD_SMTP_URL || null;

  const hub = await startHub({
    dbPath,
    port,
    host,
    origins,
    trustProxy,
    publicUrl,
    smtpUrl,
    rateLimit: {
      limit: intFromEnv(process.env.PARTYCOD_RATE_LIMIT, 10),
      windowMs: intFromEnv(process.env.PARTYCOD_RATE_WINDOW_MS, 60_000),
    },
    log: console.error,
  });

  console.log(
    `partycod ${VERSION} (protocol ${PROTOCOL_VERSION}, schema ${SCHEMA_VERSION}) listening on ${hub.url}`,
  );
  console.log(`  database: ${path.resolve(dbPath)}`);
  console.log(`  origins:  ${origins ? origins.join(', ') : 'http://localhost:* (dev default)'}`);
  console.log(`  join:     ${publicUrl ?? hub.url}/join/…${publicUrl ? '' : '  (set PARTYCOD_PUBLIC_URL)'}`);
  if (smtpUrl) {
    console.log('  mail:     настроена, но отправка приглашений ещё не реализована — ссылку отдаёт UI');
  }
  if (host === '0.0.0.0') {
    console.warn(
      '  WARNING: bound to 0.0.0.0 over plain HTTP. Passwords cross this socket in the clear — put a TLS terminator in front.',
    );
  }

  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\npartycod: ${signal}, shutting down`);
      hub.close().then(
        () => process.exit(0),
        (err) => {
          console.error(err);
          process.exit(1);
        },
      );
    });
  }
}

// `node src/index.js` runs the daemon; `import` from a test does not.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, 'index.js');

if (invokedDirectly) {
  main().catch((err) => {
    console.error('partycod failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
