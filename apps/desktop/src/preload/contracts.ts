/**
 * Types shared across the process boundary. **No runtime code — this file must erase to nothing.**
 *
 * It lives under `src/preload` because that directory is the one both tsconfigs include, which makes
 * it the only place a type can be written once and used by the main process, the preload, and the
 * renderer alike. The alternative — the renderer importing from `src/main` — would let a careless
 * import pull Node built-ins into web content.
 *
 * Written before the implementations on purpose: the last two features in this codebase that were
 * built in parallel agreed with each other because their vocabulary existed first.
 */

/* ------------------------------------------------------------------ *
 * Result envelope
 * ------------------------------------------------------------------ */

/**
 * Every IPC call answers with this rather than throwing across the bridge.
 *
 * A thrown error would carry a stack trace into web content; a returned failure carries a sentence
 * meant for a person. The same reasoning as the hub's `{ error: { code, message } }`.
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

/* ------------------------------------------------------------------ *
 * Workspace — the folder this member is actually working in
 * ------------------------------------------------------------------ */

export interface WorkspaceInfo {
  /** Absolute path to the project folder the member chose. */
  root: string;
  /** Folder name, used as the project's display name until the hub knows better. */
  name: string;
  /** Whether `root/.git` exists. False is not an error — a folder is still a folder. */
  isGitRepo: boolean;
  /** Current branch, when this is a git repository and the branch can be read cheaply. */
  branch?: string;
}

/** One entry of the real file tree. Flat, in display order — the renderer does not walk trees. */
export interface WorkspaceEntry {
  /** Path relative to the workspace root, POSIX separators, e.g. `src/main/index.ts`. */
  path: string;
  /** Final segment, for display. */
  name: string;
  kind: 'dir' | 'file';
  /** Nesting level, 0 for entries directly in the root. */
  depth: number;
  /** Size in bytes. Files only. */
  size?: number;
}

export interface WorkspaceFile {
  path: string;
  name: string;
  /** Directory containing the file, relative to the root. Empty string at the root. */
  dir: string;
  /** UTF-8 contents. Binary and oversized files are refused rather than mangled — see `reason`. */
  text?: string;
  /** Why there is no text: `binary`, `too-large`, or `unreadable`. */
  reason?: 'binary' | 'too-large' | 'unreadable';
}

/* ------------------------------------------------------------------ *
 * Conversation — what the member and the agent actually said
 * ------------------------------------------------------------------ */

/**
 * One durable entry in a project's transcript.
 *
 * `at` is wall-clock and exists because this is persisted history a person scrolls back through —
 * the rule against showing the agent wall-clock is about the agent's own sense of time, not about
 * timestamps on stored records.
 */
export interface TranscriptEntry {
  id: string;
  at: number;
  role: 'member' | 'agent';
  /** Prose the person or the agent produced. */
  text?: string;
  /** Tools the agent used during this turn, already reduced to short human strings. */
  tools?: readonly string[];
  /** Set when the turn ended badly, so a reload shows the failure rather than a truncated answer. */
  error?: string;
  /** Set when the member stopped the turn. Not a failure. */
  cancelled?: boolean;
  /** Which provider produced it, for the model chip on reload. */
  providerId?: string;
}

/* ------------------------------------------------------------------ *
 * Bridges
 * ------------------------------------------------------------------ */

export interface WorkspaceBridge {
  /** Open the OS folder picker. Resolves to `null` when the member cancels — not an error. */
  choose(): Promise<IpcResult<WorkspaceInfo | null>>;
  /** The workspace remembered from last launch, or `null` on first run. */
  current(): Promise<IpcResult<WorkspaceInfo | null>>;
  /** Forget the current workspace, e.g. to pick a different folder. */
  clear(): Promise<IpcResult<null>>;
  /**
   * The file tree, already filtered and bounded. `dir` is relative to the root; omit for the root.
   * Never returns anything outside the workspace — the main process resolves and checks every path.
   */
  tree(dir?: string): Promise<IpcResult<readonly WorkspaceEntry[]>>;
  /** Read one file by workspace-relative path. */
  readFile(path: string): Promise<IpcResult<WorkspaceFile>>;
}

export interface TranscriptBridge {
  /** Everything stored for this workspace, oldest first. */
  load(): Promise<IpcResult<readonly TranscriptEntry[]>>;
  /** Append one entry. Returns what was stored, including the id the main process assigned. */
  append(entry: Omit<TranscriptEntry, 'id' | 'at'>): Promise<IpcResult<TranscriptEntry>>;
  /** Start a fresh transcript for this workspace. */
  clear(): Promise<IpcResult<null>>;
}
