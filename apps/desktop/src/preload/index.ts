import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent, CliDetection } from '@partyco/agents';
import type {
  AgentCancelOutcome,
  AgentKeyReport,
  AgentPolicyCatalog,
  AgentRunInput,
  AgentRunOutcome,
  AgentStreamMessage,
  IpcResult,
} from '../main/agents.ts';
import type {
  Page,
  TranscriptBridge,
  TranscriptEntry,
  WorkspaceBridge,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceInfo,
} from './contracts.ts';

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

/* ------------------------------------------------------------------ *
 * Provider layer
 * ------------------------------------------------------------------ */

/**
 * The IPC contract is imported from `main/agents.ts` as types only, never re-declared.
 *
 * Two copies of a validated shape drift, and the copy that drifts is always the one the validator is
 * not looking at. `import type` is erased before the preload is bundled, so nothing from the main
 * process ends up in this sandboxed context — only the shapes.
 */
export type {
  AgentCancelOutcome,
  AgentKeyReport,
  AgentKeyState,
  AgentPolicyCatalog,
  AgentRunInput,
  AgentRunOutcome,
  IpcResult,
} from '../main/agents.ts';

/**
 * A started turn.
 *
 * Returned synchronously so the caller has the `runId` — and therefore a stop button — from the
 * first frame, rather than after the promise that only settles when the turn is over.
 */
export interface AgentRun {
  runId: string;
  /** Settles when the turn ends, whether it finished, failed or was cancelled. */
  done: Promise<IpcResult<AgentRunOutcome>>;
  /** Same as `agents.cancel(runId)`, kept on the handle so the caller need not store the id. */
  cancel(): Promise<IpcResult<AgentCancelOutcome>>;
}

export interface AgentsBridge {
  /** Which vendor CLIs are installed here. Presence only — no credential is ever inspected. */
  detect(): Promise<IpcResult<readonly CliDetection[]>>;
  /** Vendor policy as data, so the UI can refuse a transport with its citation attached. */
  policy(): Promise<IpcResult<AgentPolicyCatalog>>;
  /** Start one turn. `onEvent` fires for every event until the run ends. */
  run(request: AgentRunInput, onEvent: (event: AgentEvent) => void): AgentRun;
  cancel(runId: string): Promise<IpcResult<AgentCancelOutcome>>;
  /**
   * Hand the main process a key for this provider. An empty string forgets it.
   *
   * There is no `getKey`, by design: the key stays on the main side of the bridge and the renderer
   * only ever learns `hasKey`. Do not mirror the value into component state or `localStorage` —
   * that would put it back in web content, which is the one place it must not be.
   */
  setKey(providerId: string, key: string): Promise<IpcResult<AgentKeyReport>>;
  /**
   * Per-provider `hasKey`, plus `persisted` — whether a saved key survives quitting the app.
   *
   * `persisted` is a real boolean and both values happen: the main process encrypts keys with the
   * OS keychain, and on a machine where the OS refuses to encrypt it writes nothing at all rather
   * than storing plaintext. The UI must say which of the two it is, because the member's next
   * launch differs — and a promise of persistence that the OS quietly declined is the kind of lie
   * this bridge exists to make impossible.
   */
  keyStatus(): Promise<IpcResult<AgentKeyReport>>;
}

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
  /** Model providers: detection, policy, one turn at a time. See `main/agents.ts`. */
  agents: AgentsBridge;
  /**
   * The folder this member actually works in, and its real contents.
   *
   * Every path crossing this boundary is resolved and checked against the workspace root on the
   * other side. Nothing here takes an absolute path, and nothing here returns one except `root`
   * itself — the renderer draws repository content, which is the least trustworthy input in the
   * product, and a path it invents must not be able to reach outside the folder the member chose.
   */
  workspace: WorkspaceBridge;
  /** Durable conversation history for the current workspace. See `main/transcript.ts`. */
  transcript: TranscriptBridge;
}

/**
 * A run id, generated here rather than in the main process.
 *
 * The reason is a race, not a preference: events start flowing the moment `agents:run` is handled,
 * and a listener attached only after that invoke resolves would miss everything the CLI said in the
 * meantime. Generating the id on this side lets the listener exist before the run does.
 *
 * `crypto.randomUUID` needs a secure context, which `file://` and `http://localhost` both are; the
 * fallback exists so a preload in some future non-secure context degrades to a different UUID
 * source rather than to a crash.
 */
function newRunId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10x
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cancelRun(runId: string): Promise<IpcResult<AgentCancelOutcome>> {
  return ipcRenderer.invoke('agents:cancel', runId) as Promise<IpcResult<AgentCancelOutcome>>;
}

/**
 * Subscribe, run, unsubscribe.
 *
 * The listener is removed on the main process's `end` marker and again when the invoke settles,
 * whichever happens first — `removeListener` is idempotent, and a run that leaks its listener leaks
 * one per turn for the lifetime of the window.
 */
function startRun(request: AgentRunInput, onEvent: (event: AgentEvent) => void): AgentRun {
  const runId = newRunId();
  const channel = `agents:event:${runId}`;

  let listening = true;
  const stop = (): void => {
    if (!listening) return;
    listening = false;
    ipcRenderer.removeListener(channel, listener);
  };
  const listener = (_event: unknown, message: AgentStreamMessage): void => {
    if (message.type === 'end') {
      stop();
      return;
    }
    onEvent(message.event);
  };

  ipcRenderer.on(channel, listener);

  const done = (
    ipcRenderer.invoke('agents:run', { ...request, runId }) as Promise<IpcResult<AgentRunOutcome>>
  ).finally(stop);

  return { runId, done, cancel: () => cancelRun(runId) };
}

const agents: AgentsBridge = {
  detect: () => ipcRenderer.invoke('agents:detect') as Promise<IpcResult<readonly CliDetection[]>>,
  policy: () => ipcRenderer.invoke('agents:policy') as Promise<IpcResult<AgentPolicyCatalog>>,
  run: startRun,
  cancel: cancelRun,
  setKey: (providerId, key) =>
    ipcRenderer.invoke('agents:setKey', providerId, key) as Promise<IpcResult<AgentKeyReport>>,
  keyStatus: () => ipcRenderer.invoke('agents:keyStatus') as Promise<IpcResult<AgentKeyReport>>,
};

/**
 * Workspace and transcript are plain pass-throughs — no logic on this side on purpose.
 *
 * The temptation is to normalise a path here, or to cache the tree, because this file already knows
 * the shape. Both would be wrong: the preload runs with `contextIsolation` but inside the renderer
 * process, so anything it decides is a decision made on the untrusted side. Validation belongs where
 * the filesystem is.
 */
const workspace: WorkspaceBridge = {
  choose: () =>
    ipcRenderer.invoke('workspace:choose') as Promise<IpcResult<WorkspaceInfo | null>>,
  current: () =>
    ipcRenderer.invoke('workspace:current') as Promise<IpcResult<WorkspaceInfo | null>>,
  clear: () => ipcRenderer.invoke('workspace:clear') as Promise<IpcResult<null>>,
  tree: (dir) =>
    ipcRenderer.invoke('workspace:tree', dir) as Promise<IpcResult<Page<WorkspaceEntry>>>,
  readFile: (path) =>
    ipcRenderer.invoke('workspace:readFile', path) as Promise<IpcResult<WorkspaceFile>>,
};

const transcript: TranscriptBridge = {
  load: () => ipcRenderer.invoke('transcript:load') as Promise<IpcResult<Page<TranscriptEntry>>>,
  append: (entry) =>
    ipcRenderer.invoke('transcript:append', entry) as Promise<IpcResult<TranscriptEntry>>,
  clear: () => ipcRenderer.invoke('transcript:clear') as Promise<IpcResult<null>>,
};

const bridge: PartyCoBridge = {
  appInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  nativeTheme: () => ipcRenderer.invoke('theme:native') as Promise<'dark' | 'light'>,
  coreEndpoint: () => ipcRenderer.invoke('core:endpoint') as Promise<CoreEndpoint | null>,
  windowControl: (action) => ipcRenderer.invoke('window:controls', action) as Promise<void>,
  readDoc: (name) => ipcRenderer.invoke('docs:read', name) as Promise<string | null>,
  agents,
  workspace,
  transcript,
};

contextBridge.exposeInMainWorld('partyco', bridge);
