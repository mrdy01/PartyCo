import { mkdir } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { openLocalSession, startHub, type RunningHub, type HubSessionGrant } from '@partyco/hub';
import { platformPaths } from './platform.ts';

/**
 * The hub that raises itself.
 *
 * PartyCo's identity has always come from a hub, and still does. What changed is who has to stand
 * one up: until now the answer was "the person, before they may see the product", and the honest
 * consequence was that a stranger who downloaded the application got a sign-in form for a server
 * that did not exist. For a team that price is paid once by one person; for anyone evaluating the
 * thing alone it is the whole experience.
 *
 * So the desktop starts one for itself, on loopback, on first launch and every launch after.
 *
 * **In this process, not a child of it** — and that is the decision most worth explaining, because a
 * separate `partycod` is what production looks like and this deliberately is not that:
 *
 *  - A child process must be found (packaged, unpacked from the asar, located by a path that differs
 *    between `npm run dev` and an installed build), supervised, restarted, and above all *killed* —
 *    and a supervisor that fails to kill leaves a stranger's machine with an orphan holding a port
 *    and a database lock, with no UI left to tell them so. Every one of those is a real Windows bug
 *    with a real failure mode, bought to isolate a server that serves exactly one person.
 *  - In-process, shutdown is `close()` on the object we are holding, and there is no second thing
 *    that can outlive the window.
 *
 * The trade is crash-coupling: a hub that throws takes the window with it. For a zero-dependency
 * server with 48 tests serving one loopback client, that is the cheaper risk — and it is honest,
 * because a hub that has died is a product that cannot work anyway.
 *
 * None of this is the deployment story. `npm start -w @partyco/hub` on a VPS is still exactly what a
 * team runs, still a separate daemon, still the same code — this file only removes the requirement
 * that a person do it before they are allowed to try the product. See `apps/hub/README.md`.
 */

/**
 * Bound to loopback, and never configurable from here.
 *
 * The embedded hub carries an account that requires no password, which is safe for precisely as long
 * as the only thing that can reach it is a process on this machine. A `0.0.0.0` binding would put a
 * passwordless owner account on the network, so this is not a default — it is an invariant, and the
 * argument in `local.js` depends on it.
 */
const HOST = '127.0.0.1';

/**
 * Port 0: the OS picks a free one.
 *
 * Not 7717. That is the documented port for a real deployment, and a member running a team hub on
 * this same machine would otherwise find one of the two silently unable to bind. Letting the OS
 * choose means the embedded hub never collides with anything, including a second copy of itself.
 */
const PORT = 0;

export interface LocalHubReady {
  status: 'ready';
  url: string;
  session: HubSessionGrant;
}

export interface LocalHubFailed {
  status: 'failed';
  /** Russian, human, and specific enough to act on — this is the only screen the member will get. */
  reason: string;
}

export type LocalHubState = LocalHubReady | LocalHubFailed;

let running: RunningHub | null = null;
let state: LocalHubState | null = null;
let starting: Promise<LocalHubState> | null = null;

/**
 * What the member is told when the hub could not start.
 *
 * Named cases rather than one sentence, because the three have nothing in common but the outcome:
 * one is fixed by closing another copy, one by restoring a backup, one by nothing the member can do.
 * A single «не удалось запустить» would leave all three staring at the same dead end.
 */
function explain(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (/schema version/i.test(message)) {
    return (
      'Локальная база PartyCo сделана более новой версией программы, и эта её прочитать не может. ' +
      'Обнови PartyCo — или, если откатываешься намеренно, убери файл hub.db из папки данных: ' +
      'аккаунт и состав проекта создадутся заново, рабочая папка и история разговора не пострадают.'
    );
  }

  if (/SQLITE_BUSY|database is locked/i.test(message)) {
    return (
      'Локальная база PartyCo занята другим процессом. Скорее всего запущена вторая копия ' +
      'программы или собственный partycod — закрой её и открой PartyCo снова.'
    );
  }

  if (/EADDRINUSE|EACCES|EPERM/i.test(message)) {
    return (
      'PartyCo не смог открыть локальный порт для своей служебной части. Обычно это делает ' +
      'антивирус или корпоративный firewall — разреши программе локальные соединения и запусти ' +
      `её снова. (${message})`
    );
  }

  return `PartyCo не смог запустить свою служебную часть, поэтому войти не получится. (${message})`;
}

/**
 * Start the hub and open this machine's session. Idempotent, and safe to call from several places.
 *
 * The promise is memoised rather than the result, so two callers racing at startup wait on one
 * server instead of starting two against the same database file.
 */
export function ensureLocalHub(): Promise<LocalHubState> {
  if (state) return Promise.resolve(state);
  if (starting) return starting;

  starting = (async (): Promise<LocalHubState> => {
    try {
      const paths = platformPaths();
      await mkdir(paths.data, { recursive: true });

      /*
       * The database lives in the per-user data directory, not next to the executable.
       *
       * `npm start -w @partyco/hub` writes `./hub.db` beside the process, which is right for an
       * operator who chose where to run it and wrong for an installed application: Program Files is
       * not writable, and a per-machine file would hand the next Windows account somebody else's
       * conversation. Same file name, so an operator recognises it.
       */
      const hub = await startHub({
        dbPath: join(paths.data, 'hub.db'),
        port: PORT,
        host: HOST,
        /*
         * No browser origin may talk to this hub.
         *
         * The renderer is `file://`, which sends `Origin: null` and is not subject to the allowlist
         * the way a page on a real origin is. An empty allowlist is therefore the tightest setting
         * that still lets our own window through, and it means a page the member happens to have
         * open in Chrome cannot reach the passwordless account on their own loopback.
         */
        origins: [],
        log: () => {},
      });

      running = hub;

      /*
       * The display name is a courtesy and a fallback, not an identity.
       *
       * The OS account name is the one true thing available without asking anybody anything on a
       * first launch that is supposed to have no questions in it. If it is unreadable — a locked
       * down container, a service account — the hub derives a handle from the address instead, which
       * is why this is allowed to fail quietly.
       */
      let displayName = '';
      try {
        displayName = userInfo().username;
      } catch {
        displayName = '';
      }

      const session = openLocalSession(hub.db, { displayName });

      state = { status: 'ready', url: hub.url, session };
      return state;
    } catch (cause) {
      /*
       * A half-started hub is closed before the failure is reported. `startHub` opens the database
       * before it listens, so a bind error leaves a live handle on `hub.db` — and the message we are
       * about to show tells the member to try again, which would then fail differently.
       */
      if (running) {
        await running.close().catch(() => undefined);
        running = null;
      }
      state = { status: 'failed', reason: explain(cause) };
      return state;
    } finally {
      starting = null;
    }
  })();

  return starting;
}

/** The current answer without starting anything — for callers that must not block a paint. */
export function localHubState(): LocalHubState | null {
  return state;
}

/**
 * Close the hub on the way out.
 *
 * Awaited by `will-quit` so SQLite gets to check the WAL back in. Skipping it does not corrupt the
 * database — that is what journalling is for — but it leaves `-wal` and `-shm` beside it, and the
 * next launch pays a recovery pass for nothing.
 */
export async function closeLocalHub(): Promise<void> {
  const hub = running;
  running = null;
  state = null;
  if (!hub) return;
  await hub.close().catch(() => undefined);
}
