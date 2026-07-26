import { contextBridge, ipcRenderer } from 'electron';

/**
 * The entire surface the renderer gets. Deliberately tiny and fully enumerated — no generic
 * `invoke(channel, ...args)` escape hatch, because that would hand the renderer the whole main
 * process the moment any XSS lands, and this renderer displays repository content and model output.
 */

export interface PlatformPaths {
  config: string;
  data: string;
  runtime: string;
  worktreeRoot: string;
  logs: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  isPackaged: boolean;
  paths: PlatformPaths;
}

export interface CoreEndpoint {
  port: number;
  token: string;
  protocolVersion: string;
  pid: number;
}

export type WindowAction = 'minimize' | 'maximize' | 'close';

export interface PartyCoBridge {
  appInfo(): Promise<AppInfo>;
  /** OS-level colour preference at startup, so first paint matches and does not flash. */
  nativeTheme(): Promise<'dark' | 'light'>;
  /**
   * Endpoint of the local core daemon, or null when it is not running. The renderer opens its own
   * WebSocket to `ws://127.0.0.1:<port>` and authenticates with `token`.
   */
  coreEndpoint(): Promise<CoreEndpoint | null>;
  windowControl(action: WindowAction): Promise<void>;
  /** Reads one of the shipped architecture docs by filename. Rejects anything path-like. */
  readDoc(name: string): Promise<string | null>;
}

const bridge: PartyCoBridge = {
  appInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  nativeTheme: () => ipcRenderer.invoke('theme:native') as Promise<'dark' | 'light'>,
  coreEndpoint: () => ipcRenderer.invoke('core:endpoint') as Promise<CoreEndpoint | null>,
  windowControl: (action) => ipcRenderer.invoke('window:controls', action) as Promise<void>,
  readDoc: (name) => ipcRenderer.invoke('docs:read', name) as Promise<string | null>,
};

contextBridge.exposeInMainWorld('partyco', bridge);
