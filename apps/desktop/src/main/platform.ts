import { app } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The platform-abstraction surface for the SHELL. Everything OS-specific that the desktop app
 * touches lives here, so the macOS port is a matter of filling in one branch rather than hunting
 * `process.platform` checks across the codebase. See docs/architecture.md §11.
 *
 * The core daemon has its own, larger platform layer (PTY, keychain, sandbox, file watching);
 * this one only covers what the shell needs.
 */

export interface PlatformPaths {
  /** Per-user config that PartyCo writes. */
  config: string;
  /** Per-user state: local.db, session transcripts, caches. */
  data: string;
  /** Runtime discovery files: portfile + lockfile for the local daemon. */
  runtime: string;
  /** Where worktrees are provisioned. Short root on Windows — MAX_PATH bites otherwise. */
  worktreeRoot: string;
  /** Logs. */
  logs: string;
}

export function platformPaths(): PlatformPaths {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    const localAppData = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    return {
      config: join(appData, 'PartyCo'),
      data: join(localAppData, 'PartyCo'),
      runtime: join(localAppData, 'PartyCo', 'run'),
      // Deliberately NOT under Documents or the user profile: deep nesting inside a long profile
      // path overflows MAX_PATH on both creation and deletion of a worktree.
      worktreeRoot: 'C:\\pco',
      logs: join(localAppData, 'PartyCo', 'logs'),
    };
  }

  if (process.platform === 'darwin') {
    const support = join(homedir(), 'Library', 'Application Support', 'PartyCo');
    return {
      config: support,
      data: support,
      // XDG_RUNTIME_DIR does not exist on macOS; the app sandbox-safe equivalent is the app's own
      // temp dir, which is per-user and cleaned by the OS.
      runtime: join(app.getPath('temp'), 'PartyCo'),
      worktreeRoot: join(homedir(), 'PartyCo', 'worktrees'),
      logs: join(homedir(), 'Library', 'Logs', 'PartyCo'),
    };
  }

  // Linux is not a target for v1, but the daemon runs there (hub mode / Docker), so keep the
  // branch honest rather than silently falling through to Windows paths.
  const xdgConfig = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
  const xdgData = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');
  const xdgRuntime = process.env['XDG_RUNTIME_DIR'] ?? join(app.getPath('temp'), 'partyco');
  return {
    config: join(xdgConfig, 'partyco'),
    data: join(xdgData, 'partyco'),
    runtime: join(xdgRuntime, 'partyco'),
    worktreeRoot: join(homedir(), '.partyco', 'worktrees'),
    logs: join(xdgData, 'partyco', 'logs'),
  };
}

/** Named-pipe / unix-socket path for the local daemon, per docs/architecture.md §2.2. */
export function daemonSocketPath(projectHash: string): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\partyco-${projectHash}`;
  return join(platformPaths().runtime, `partyco-${projectHash}.sock`);
}
