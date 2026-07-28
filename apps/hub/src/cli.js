/**
 * `partycod` as a program — the entry point `npm start -w @partyco/hub` and a systemd unit run.
 *
 * Split out of `index.js`, and the split is a bug fix rather than tidying.
 *
 * `index.js` used to end with "if this file is the process entry point, read the environment and
 * start a daemon", guarded by comparing `process.argv[1]` against its own path. That guard is right
 * for a file that is either run or imported, and wrong the moment the module is **bundled into
 * another program**: the desktop now embeds the hub in its main process, Rollup emits the whole
 * thing as `out/main/index.js`, and the comparison came out true — so launching the desktop also
 * tried to start a second, environment-configured hub on the documented port 7717. It announced
 * itself by killing the application with `EADDRINUSE` on a machine that already had a hub, and
 * would have started a silent extra daemon on one that did not.
 *
 * The fix is the ordinary rule it broke: a module meant to be imported has no side effects at
 * import time. `index.js` is now only exports; everything that reads the environment, writes to the
 * console, installs signal handlers or calls `process.exit` lives here, in a file nothing imports.
 */

import path from 'node:path';
import process from 'node:process';

import { SCHEMA_VERSION } from './db.js';
import { parseOrigins } from './http.js';
import { DEFAULT_PORT, PROTOCOL_VERSION, VERSION, startHub } from './index.js';

/**
 * @param {string|undefined} raw
 * @param {number} fallback
 */
function intFromEnv(raw, fallback) {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Read the environment and start. */
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

/*
 * Unconditional, and that is the point of this file existing.
 *
 * There is no "was I invoked directly?" test here, because nothing imports this module — so the
 * question cannot arise, and the guard that used to answer it cannot be wrong again.
 */
main().catch((err) => {
  console.error('partycod failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
