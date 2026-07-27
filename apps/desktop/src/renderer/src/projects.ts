/**
 * Which project this member is working in.
 *
 * Three decisions carry this file.
 *
 * **No project is not a failure.** The hub creates nothing implicitly — registering does not conjure
 * «Мой проект» — so a member with an empty list is in a normal, expected state: the thing has not
 * been made yet. `state` is `ready`, `error` is `null` and `current` is `null`, and the shell says
 * so in words. Reporting that as an error would be the product blaming somebody for a step nobody
 * has taken.
 *
 * **A remembered choice that no longer exists is not a failure either.** Projects can vanish from a
 * member's list — somebody else's hub, a rebuilt database, a person removed from a project. The
 * remembered id is then simply not found, and the first available project is used instead, silently.
 * The alternative — an error about an id the person never typed and cannot fix — explains nothing.
 *
 * **The choice is remembered per member, not per machine.** Two people who sign in on one laptop
 * must not inherit each other's project, so the member id is part of the storage key. It is a
 * preference, not a credential: losing it costs one click.
 *
 * Refusals from the hub are shown as the hub wrote them. It already answers in Russian a person can
 * act on («Дайте проекту имя.», «Имя проекта — не длиннее 64 знаков.»), and paraphrasing a refusal
 * on this side only makes it vaguer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createProject as createHubProject,
  projects as readHubProjects,
  type HubProject,
  type HubSession,
} from './hub.ts';

export type ProjectsState = 'loading' | 'ready' | 'error';

export interface ProjectsModel {
  /** Every project this member is in, in the hub's order (oldest first). */
  projects: readonly HubProject[];
  /** The one being worked in. `null` means there are none yet — not «still loading». */
  current: HubProject | null;
  state: ProjectsState;
  /** The last refusal, in the hub's own words. `null` when nothing has been refused. */
  error: string | null;
  /** A project is being created right now. */
  busy: boolean;
  select: (projectId: string) => void;
  /** Resolves to the created project, or to `null` — in which case `error` holds the reason. */
  create: (name: string) => Promise<HubProject | null>;
  reload: () => void;
}

/* ------------------------------------------------------------------ *
 * The remembered choice
 * ------------------------------------------------------------------ */

/**
 * One key per member. `partyco.project.<memberId>`.
 *
 * Not one key holding a map of members: a map has to be parsed, merged and written back, and every
 * one of those steps is a chance to lose somebody else's entry while saving your own.
 */
function selectionKey(memberId: string): string {
  return `partyco.project.${memberId}`;
}

function readSelection(memberId: string): string | null {
  try {
    const stored = window.localStorage.getItem(selectionKey(memberId));
    return stored !== null && stored !== '' ? stored : null;
  } catch {
    return null;
  }
}

function writeSelection(memberId: string, projectId: string | null): void {
  try {
    if (projectId === null) window.localStorage.removeItem(selectionKey(memberId));
    else window.localStorage.setItem(selectionKey(memberId), projectId);
  } catch {
    // Storage can be off entirely. Then the choice lasts one session, which is a smaller loss than
    // refusing to switch projects at all.
  }
}

/**
 * A refusal in the words it arrived in.
 *
 * `HubError.message` is already the hub's Russian sentence. The fallback is only for the case where
 * something that is not an `Error` was thrown, which no path in `hub.ts` does.
 */
function sentenceOf(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim() !== '') return cause.message;
  return fallback;
}

/* ------------------------------------------------------------------ *
 * The hook
 * ------------------------------------------------------------------ */

export function useProjects(session: HubSession): ProjectsModel {
  const [projects, setProjects] = useState<readonly HubProject[]>([]);
  const [state, setState] = useState<ProjectsState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const memberId = session.member.id;
  const [selectedId, setSelectedId] = useState<string | null>(() => readSelection(memberId));

  // Signing out and back in as somebody else must not inherit the previous person's project. The
  // value is read again rather than cleared, so each member keeps their own.
  useEffect(() => {
    setSelectedId(readSelection(memberId));
  }, [memberId]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // `create` reads the load state through a ref rather than through its closure: the answer comes
  // back later than the click, and what matters is the state at that moment, not at the press.
  const stateRef = useRef<ProjectsState>(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError(null);

    void readHubProjects(session.hubUrl, session.token)
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        setState('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // The list is dropped rather than kept: a read that failed says nothing about what is on the
        // hub now, and a stale list under an error banner is a set of projects the app is no longer
        // in a position to claim.
        setProjects([]);
        setError(sentenceOf(cause, 'Не удалось прочитать список проектов.'));
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [session.hubUrl, session.token, nonce]);

  /**
   * The remembered project if it is still there, otherwise the first one, otherwise none.
   *
   * Derived rather than stored, so it cannot drift from the list: the single-project case selects
   * itself by the same line that recovers from a project that disappeared.
   */
  const current = useMemo<HubProject | null>(() => {
    if (selectedId !== null) {
      const remembered = projects.find((project) => project.id === selectedId);
      if (remembered) return remembered;
    }
    return projects[0] ?? null;
  }, [projects, selectedId]);

  const select = useCallback(
    (projectId: string) => {
      setSelectedId(projectId);
      writeSelection(memberId, projectId);
    },
    [memberId],
  );

  const create = useCallback(
    async (name: string): Promise<HubProject | null> => {
      setBusy(true);
      setError(null);
      try {
        // The name goes to the hub as typed. Validating it here too would mean two sets of rules for
        // one field, and the hub's refusals are already sentences a person can act on.
        const created = await createHubProject(session.hubUrl, session.token, { name });
        if (!alive.current) return created;

        // The created project is the hub's own answer about itself, so it is appended rather than
        // guessed at, and it becomes current immediately — somebody who just made a project meant to
        // work in it.
        setProjects((list) => [...list, created]);
        setSelectedId(created.id);
        writeSelection(memberId, created.id);

        // A list that failed to load is now known to be readable — but it is still one project short
        // of the truth, and showing just the new one would claim it is everything. Re-read instead.
        if (stateRef.current === 'error') setNonce((n) => n + 1);
        return created;
      } catch (cause: unknown) {
        if (alive.current) setError(sentenceOf(cause, 'Не удалось создать проект.'));
        return null;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [session.hubUrl, session.token, memberId],
  );

  return {
    projects,
    current,
    state,
    error,
    busy,
    select,
    create,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}
