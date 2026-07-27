/**
 * The workspace — the one folder this member is working in — as the renderer sees it.
 *
 * Four facts shape everything below.
 *
 * **There is one workspace per window, so there is one copy of it here.** The state lives in this
 * module and every `useWorkspace()` reads the same snapshot: the shell needs the folder for its
 * file tree, first run needs it to know whether to appear, settings needs it to let go of it. Three
 * hook instances with three private copies would mean three reads of `current()` and three chances
 * to disagree about whether a folder exists — and the second consumer would sit in `loading` while
 * the first already knew the answer.
 *
 * **The bridge can be absent.** `npm run dev:web` renders this same tree in a plain browser with no
 * main process at all, and a preload that fails to load leaves `window.partyco` undefined in
 * Electron too. That is reported as `unavailable`, which is a different answer from «no folder has
 * been chosen yet»: the first says *I cannot know*, the second is a fact about the member. Folding
 * one into the other is how a product ends up showing a first-run step whose button cannot work.
 *
 * **Nothing here throws.** The bridge answers with `IpcResult` by design, and the one case it
 * cannot cover — a rejected `invoke`, i.e. no handler on the other side — is folded into the same
 * envelope by `call` below. A component reading this hook never needs a `try`.
 *
 * **Cancelling the picker is an answer.** `choose()` resolving to `null` means the member closed
 * the dialog; the workspace stays exactly as it was and no error is raised. Treating that as a
 * failure is the surest way to make a folder picker feel hostile.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { IpcResult, WorkspaceBridge, WorkspaceInfo } from '../../preload/contracts.ts';

/**
 * `loading` — the remembered workspace is being read; nothing should be drawn from it yet.
 * `ready` — the answer is in. `workspace` may still be `null`: that is first run.
 * `unavailable` — there is no bridge in this window, so the question cannot be asked at all.
 * `error` — the main process refused or never answered; `error` carries its sentence.
 */
export type WorkspaceState = 'loading' | 'ready' | 'unavailable' | 'error';

export interface WorkspaceHandle {
  /** The chosen folder, or `null` — which means first run, not "still loading". */
  workspace: WorkspaceInfo | null;
  state: WorkspaceState;
  /** Human sentence from the last failure, or `null`. A cancelled picker never sets this. */
  error: string | null;
  /** A picker is open, or the workspace is being forgotten. */
  busy: boolean;
  /** Open the OS folder picker. Resolves to the chosen folder, or `null` on cancel or failure. */
  choose: () => Promise<WorkspaceInfo | null>;
  /**
   * Forget the current folder — to point the app at a different project, or on sign-out.
   *
   * Returns the envelope rather than `void` because one caller has to speak when this fails.
   * Signing out drops the session whether or not the folder could be forgotten, so a failure here
   * is a fact the *next* person at this machine inherits — and inherits silently unless somebody
   * prints it. The same sentence still lands in `error` on the snapshot for the screens that read
   * it; the return value exists for the screen that has already stopped reading it.
   */
  clear: () => Promise<IpcResult<null>>;
}

/**
 * What the app says when there is no bridge to ask.
 *
 * Exported because first run has to state it before the member presses anything — a step that only
 * admits it is broken *after* a click is worse than one that says so up front.
 */
export const WORKSPACE_UNAVAILABLE =
  'Приложение не смогло связаться со своей системной частью, поэтому выбрать папку сейчас нельзя. ' +
  'Перезапусти PartyCo — если повторится, переустанови.';

/* ------------------------------------------------------------------ *
 * The bridge
 * ------------------------------------------------------------------ */

/**
 * The workspace half of the bridge, or `null` when this window has none.
 *
 * The runtime check is not ceremony even though the type says the property is always there: in a
 * browser there is no `partyco` at all, and a preload that failed halfway through leaves an object
 * on the window with methods missing. Calling one of those inside a render is a `TypeError`, which
 * in a desktop app is a white window with no way back.
 */
function readBridge(): WorkspaceBridge | null {
  const bridge = window.partyco?.workspace as Partial<WorkspaceBridge> | undefined;
  if (!bridge) return null;
  // Only the three this module calls. Demanding `tree`/`readFile` here would reject a usable
  // bridge on behalf of a caller that never asked for them.
  if (typeof bridge.current !== 'function') return null;
  if (typeof bridge.choose !== 'function') return null;
  if (typeof bridge.clear !== 'function') return null;
  return bridge as WorkspaceBridge;
}

/**
 * One envelope for both kinds of "no".
 *
 * The main process returns `{ ok: false, error }` for anything it can explain. A rejected `invoke`
 * — no handler registered, a throw before the handler could answer — is not explainable, and the
 * underlying message is appended in brackets rather than swallowed: at this stage of the product
 * «нет обработчика workspace:choose» is exactly the sentence somebody needs to read.
 */
async function call<T>(run: () => Promise<IpcResult<T>>, fallback: string): Promise<IpcResult<T>> {
  try {
    return await run();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message.trim() : '';
    return { ok: false, error: detail === '' ? fallback : `${fallback} (${detail})` };
  }
}

/* ------------------------------------------------------------------ *
 * The one copy of the state
 * ------------------------------------------------------------------ */

type Snapshot = Pick<WorkspaceHandle, 'workspace' | 'state' | 'error' | 'busy'>;

let snapshot: Snapshot = { workspace: null, state: 'loading', error: null, busy: false };
const listeners = new Set<() => void>();

/**
 * `getSnapshot` must return the same object until something actually changes — React calls it
 * during render and compares by identity, so a fresh literal each time is an infinite loop. Hence
 * one frozen value replaced wholesale here rather than four pieces of mutable state.
 */
function publish(change: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...change };
  // Copied because a listener may unsubscribe (unmount) while this loop is running.
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

/**
 * Read the remembered folder, once per window.
 *
 * Guarded by a module flag rather than by an effect's dependency list: React mounts effects twice
 * in development (StrictMode), and every consumer of this hook runs the same effect, so "once" has
 * to be a fact about the window and not about a component.
 */
let started = false;

function ensureLoaded(): void {
  if (started) return;
  started = true;

  const bridge = readBridge();
  if (!bridge) {
    // Not an error, and not an empty folder — a window that cannot answer the question.
    publish({ state: 'unavailable' });
    return;
  }

  void call(() => bridge.current(), 'Не удалось прочитать рабочую папку.').then((result) => {
    if (!result.ok) {
      publish({ state: 'error', error: result.error });
      return;
    }
    publish({ workspace: result.value, state: 'ready', error: null });
  });
}

async function choose(): Promise<WorkspaceInfo | null> {
  const bridge = readBridge();
  if (!bridge) {
    publish({ state: 'unavailable', error: WORKSPACE_UNAVAILABLE });
    return null;
  }

  publish({ busy: true, error: null });
  const result = await call(() => bridge.choose(), 'Не удалось открыть выбор папки.');

  if (!result.ok) {
    publish({ busy: false, error: result.error });
    return null;
  }
  // Cancelled. The folder that was there is still there, and nothing is said about it.
  if (result.value === null) {
    publish({ busy: false });
    return null;
  }

  publish({ workspace: result.value, state: 'ready', error: null, busy: false });
  return result.value;
}

async function clear(): Promise<IpcResult<null>> {
  const bridge = readBridge();
  if (!bridge) {
    publish({ state: 'unavailable', error: WORKSPACE_UNAVAILABLE });
    return { ok: false, error: WORKSPACE_UNAVAILABLE };
  }

  publish({ busy: true, error: null });
  const result = await call(() => bridge.clear(), 'Не удалось забыть рабочую папку.');

  if (!result.ok) {
    publish({ busy: false, error: result.error });
    return result;
  }
  publish({ workspace: null, state: 'ready', error: null, busy: false });
  return result;
}

/* ------------------------------------------------------------------ *
 * The hook
 * ------------------------------------------------------------------ */

export function useWorkspace(): WorkspaceHandle {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  // In an effect, not at import time: importing a module must not open IPC, or a unit test that
  // touches this file starts talking to a main process that is not there.
  useEffect(ensureLoaded, []);
  return { ...current, choose, clear };
}
