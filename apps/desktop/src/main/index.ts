import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { platformPaths } from './platform.ts';
import { readCoreEndpoint, type CoreEndpoint } from './core-endpoint.ts';
import { abortAllAgentRuns, registerAgentIpc } from './agents.ts';
import { closeLocalHub, ensureLocalHub, type LocalHubState } from './hub-local.ts';
import { currentWorkspaceRoot, registerWorkspaceIpc } from './workspace.ts';
import { registerTranscriptIpc } from './transcript.ts';

const isDev = !app.isPackaged;

/**
 * PartyCo desktop shell.
 *
 * The shell is deliberately thin: it owns the window, the OS integration and the discovery of the
 * local core daemon (`partycod --agent`). It does NOT own product logic, and it never speaks to a
 * model provider — that happens in the core daemon, on this member's machine, with this member's
 * credentials. See docs/architecture.md §2.
 */

let mainWindow: BrowserWindow | null = null;

/**
 * Hand a URL to the OS — but only a web one.
 *
 * `shell.openExternal` is the widest hole an Electron shell has: it runs whatever the OS has
 * registered for the scheme. `file:///C:/…/anything.exe` starts a program, `\\host\share` makes
 * Windows authenticate to a stranger and hand over an NTLM hash, and `ms-msdt:` and friends have
 * been shipped exploits. The renderer here draws repository content and model output, so the URL in
 * a link or a `window.open` is attacker-influenceable text by default.
 *
 * `http`/`https` only, then, and silence otherwise: a member clicking a link expects a browser tab,
 * never a launched binary. The scheme is read by parsing rather than by matching the start of the
 * string — case varies, and a hostile URL can carry `https` inside itself while its actual scheme is
 * something else entirely.
 */
function openExternalIfWeb(url: string): void {
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    return;
  }
  if (scheme !== 'https:' && scheme !== 'http:') return;
  void shell.openExternal(url);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0D0F11' : '#F4F5F6',
    // Frameless with native window controls kept: on Windows `titleBarOverlay` draws the
    // minimise/maximise/close buttons over our own titlebar, so we get a custom bar without
    // reimplementing window management. macOS uses the inset traffic lights.
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: '#14171A',
            symbolColor: '#A0A8B0',
            height: 36,
          },
        }
      : {}),
    trafficLightPosition: { x: 12, y: 11 },
    webPreferences: {
      // `.cjs`, because `sandbox: true` below runs the preload as CommonJS and an ESM preload does
      // not load at all — see the note in `electron.vite.config.ts`.
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      // Security posture: the renderer is untrusted as far as the OS is concerned. It renders
      // repository content and model output, both of which can be attacker-influenced.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Never let the renderer navigate itself somewhere else, and never open a window in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfWeb(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL'];
    if (devServer && url.startsWith(devServer)) return;
    event.preventDefault();
    openExternalIfWeb(url);
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devServer) {
    void win.loadURL(devServer);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }

  return win;
}

/**
 * Content-Security-Policy. No external hosts at all: fonts are bundled, there are no CDN scripts,
 * and the only network peer the renderer may reach is the local core daemon over ws://127.0.0.1.
 * `'unsafe-inline'` for styles is required because CSS Modules inject <style> tags in dev; the
 * production build inlines them at build time, so the dev and prod policies differ.
 */
function installCsp(): void {
  const devServer = process.env['ELECTRON_RENDERER_URL'];
  const connect = ["'self'", 'ws://127.0.0.1:*', 'http://127.0.0.1:*'];
  if (isDev && devServer) connect.push(devServer, devServer.replace(/^http/, 'ws'));

  const policy = [
    "default-src 'none'",
    "script-src 'self'" + (isDev ? " 'unsafe-eval'" : ''),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src ${connect.join(' ')}`,
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });

  // Deny every powerful permission by default. Anything genuinely needed gets added explicitly,
  // with a product decision behind it.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, deny) => deny(false));
}

// One instance per machine: two shells fighting over the same core daemon portfile and the same
// worktrees is a corruption bug waiting to happen.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    installCsp();
    mainWindow = createWindow();

    /*
     * Started here rather than on the renderer's first ask, and not awaited.
     *
     * Opening a database and binding a socket is work that can happen while Chromium is still
     * building the window, so doing it in parallel costs nothing and takes the hub off the path
     * between launch and first paint. `ensureLocalHub` memoises its promise, so the renderer's
     * `hub:local` either finds it done or waits on this same start rather than racing a second one.
     */
    void ensureLocalHub();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  /**
   * Shutdown, in the order the two things need.
   *
   * A delegated CLI is the member's own process, started by their own action — but it is *our*
   * child, and a child that outlives the window still consumes their subscription. Quitting stops
   * every turn that is still running, and that happens first and synchronously: it is a kill, it
   * cannot fail, and it must not wait behind anything.
   *
   * The hub then needs an await that `will-quit` does not give by default, so the quit is deferred
   * once and re-issued. `closingDown` is what keeps that from being a loop — without it the second
   * `app.quit()` would land back here and defer again, and the window would never close.
   */
  let closingDown = false;
  app.on('will-quit', (event) => {
    abortAllAgentRuns();
    if (closingDown) return;
    closingDown = true;
    event.preventDefault();
    void closeLocalHub().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/* ---------------------------------------------------------------- IPC */

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform as NodeJS.Platform,
  isPackaged: app.isPackaged,
  paths: platformPaths(),
}));

ipcMain.handle('theme:native', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));

/**
 * Discovery of the local core daemon. Per docs/architecture.md §2.2 the daemon writes an atomic
 * portfile holding {pid, port, token, protocolVersion}; the shell reads it and hands the endpoint
 * to the renderer, which then talks JSON-RPC over a WebSocket. The token never reaches disk from
 * here and is not logged.
 */
ipcMain.handle('core:endpoint', async (): Promise<CoreEndpoint | null> => readCoreEndpoint());

/**
 * The hub PartyCo runs for this machine, and this member's session on it.
 *
 * No argument, and nothing the renderer can influence: the URL, the port, the database path and the
 * account are all decided in `main/hub-local.ts`. The renderer is told the answer so it can talk to
 * the hub over HTTP like any other client — it does not get to ask for a different one.
 */
ipcMain.handle('hub:local', (): Promise<LocalHubState> => ensureLocalHub());

ipcMain.handle('window:controls', (event, action: 'minimize' | 'maximize' | 'close') => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'close') win.close();
  else if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

/**
 * The provider layer: `agents:detect`, `agents:policy`, `agents:run`, `agents:cancel`,
 * `agents:setKey`, `agents:keyStatus`.
 *
 * Grouped in `main/agents.ts` rather than inlined here because that file also owns the rule this
 * shell exists to enforce: a member's API key is accepted across the bridge and never handed back,
 * and the child process's environment is built by `@partyco/agents`, never inherited.
 */
registerAgentIpc();

/**
 * The working folder: `workspace:choose`, `workspace:current`, `workspace:clear`, `workspace:tree`,
 * `workspace:readFile` — the five members of `WorkspaceBridge` in `preload/contracts.ts`.
 *
 * In `main/workspace.ts` for the same reason as the block above: that file owns the rule this one
 * cannot enforce from here — every path the renderer names is resolved through `realpath` and
 * checked against the chosen root before anything is opened, so a `..`, a symlink out of the
 * repository or a neighbouring folder whose name merely starts the same way is refused rather than
 * read. The renderer draws repository text and model output, so the paths it sends back are
 * attacker-influenceable by construction.
 */
registerWorkspaceIpc();

/**
 * The conversation on disk: `transcript:load`, `transcript:append`, `transcript:clear`.
 *
 * The resolver is the whole seam. `TranscriptBridge` takes no folder argument on purpose — the
 * renderer does not get to name the project whose history it reads — so the transcript layer asks
 * the workspace layer which folder is open, every call. One source of truth, and a member who
 * switches projects cannot end up appending to the previous project's history.
 */
registerTranscriptIpc(() => currentWorkspaceRoot());

// Read-only helper the renderer uses to show the architecture docs in-app.
ipcMain.handle('docs:read', async (_e, name: string): Promise<string | null> => {
  if (!/^[a-z0-9-]+\.md$/.test(name)) return null; // no traversal, no arbitrary reads
  try {
    const base = isDev ? join(process.cwd(), '..', '..', 'docs') : join(process.resourcesPath, 'docs');
    return await readFile(join(base, name), 'utf8');
  } catch {
    return null;
  }
});
