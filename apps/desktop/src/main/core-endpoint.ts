import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { platformPaths } from './platform.ts';

/**
 * Discovery of the local core daemon (`partycod --agent`).
 *
 * Per docs/architecture.md §2.2 the daemon writes an atomic portfile and the client must verify the
 * recorded pid is still alive before trusting it — a hard crash otherwise leaves a stale portfile
 * that the shell would happily connect to (or worse, that a different process now occupies).
 */

export interface CoreEndpoint {
  /** Loopback port for the JSON-RPC-over-WebSocket transport. */
  port: number;
  /** Bearer token for that socket. Short-lived, per-daemon-run. Never logged, never persisted here. */
  token: string;
  /** Wire protocol version, so the shell can refuse a skewed daemon instead of failing weirdly. */
  protocolVersion: string;
  pid: number;
}

interface PortFile {
  pid: unknown;
  port: unknown;
  token: unknown;
  protocolVersion: unknown;
}

/**
 * True only if `pid` is a process we own and may talk to.
 *
 * ESRCH means it is gone (stale portfile). EPERM means it exists but belongs to another user —
 * that is not our daemon, so it is equally unusable. Both are "do not connect".
 */
function isOurLiveProcess(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readCoreEndpoint(): Promise<CoreEndpoint | null> {
  const file = join(platformPaths().runtime, 'daemon.port.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null; // daemon not running — the renderer shows the "core offline" state
  }

  let parsed: PortFile;
  try {
    parsed = JSON.parse(raw) as PortFile;
  } catch {
    return null;
  }

  const { pid, port, token, protocolVersion } = parsed;
  if (
    typeof pid !== 'number' ||
    typeof port !== 'number' ||
    typeof token !== 'string' ||
    typeof protocolVersion !== 'string' ||
    !Number.isInteger(port) ||
    port <= 0 ||
    port > 65535 ||
    token.length < 16
  ) {
    return null;
  }

  if (!isOurLiveProcess(pid)) return null; // stale portfile from a crashed daemon, or a foreign pid

  return { pid, port, token, protocolVersion };
}
