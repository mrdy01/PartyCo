/**
 * The conversation: what was actually said, and what the agent actually did.
 *
 * Two halves that must not be confused. **History** is on disk, written by the main process one
 * line at a time, and it survives a restart. **The live turn** exists only while a child process is
 * running and is appended to history when it ends. The stream a person reads is history plus the
 * live turn, in that order, and nothing else — there is no seeded example, no sample teammate and
 * no invented activity, because every item here is a claim that something happened.
 *
 * Failure is written down too. A turn that ended badly is a fact about this project's history, and
 * a reload that quietly dropped it would leave a person looking at a conversation that stops
 * mid-sentence with no explanation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationItem, ProjectMember, ProviderSetupItem, WorkStep } from '@partyco/ui';
import type {
  AgentAuthMode,
  AgentEvent,
  AgentRun,
  TranscriptEntry,
  WorkspaceInfo,
} from './bridge';

export type ConversationState = 'ready' | 'loading' | 'error';

/** The provider a turn will actually run on, once the machine is known to be able to run one. */
export interface RunTarget {
  providerId: string;
  label: string;
  mode: AgentAuthMode;
}

export interface ConversationModel {
  items: readonly ConversationItem[];
  state: ConversationState;
  /**
   * How many of the **oldest** turns this stream does not contain.
   *
   * Not a length and not a total: `items` is what is on screen, and this is what was cut off before
   * it. The stored history is untouched — the number is about this answer, not about the file — and
   * the interface has to say it, because a conversation that silently starts in the middle reads as
   * a conversation that started there.
   *
   * `0` means the stream begins where the transcript begins.
   */
  omittedEarlierTurns: number;
  /** True while a child process is running. The composer becomes a stop button. */
  running: boolean;
  /** Which provider the next turn goes to, or `null` when none on this machine can run one. */
  target: RunTarget | null;
  /** Why nothing can run, in a sentence. `null` when something can. */
  blocked: string | null;
  send: (text: string) => void;
  cancel: () => void;
  reload: () => void;
  /** Expand / collapse the tool summary of one turn. */
  toggleWork: (id: string) => void;
}

/**
 * Picks the provider a turn runs on.
 *
 * A stored key wins over a signed-in CLI, for a boring reason: the key is a fact this process
 * verified (it is in the keychain), while a detected binary only means the file exists — whether
 * anybody is signed into it is unknowable without spending their tokens, which `detect.ts` refuses
 * to do. Preferring the certain one means fewer turns that fail at the vendor's auth check.
 *
 * A transport the vendor forbids is never chosen, no matter what is installed. That is the whole
 * point of carrying the policy catalogue into the client.
 */
export function chooseTarget(providers: readonly ProviderSetupItem[]): RunTarget | null {
  const usable = (status: string): boolean => status !== 'prohibited';

  for (const provider of providers) {
    if (provider.hasKey && usable(provider.apiKey.status)) {
      return { providerId: provider.id, label: provider.label, mode: 'api-key' };
    }
  }
  for (const provider of providers) {
    if (provider.detection?.found && provider.cli && usable(provider.cli.status)) {
      return { providerId: provider.id, label: provider.label, mode: 'subscription' };
    }
  }
  return null;
}

/**
 * `self` is the author of every `member` line, and that is exactly as true as it looks.
 *
 * The transcript records a role, not a person, because this file is on one member's machine and the
 * only human who can type into it is the one signed in. When projects become shared the entry gains
 * a member id and this argument becomes a lookup — writing an author id now would be recording a
 * fact nothing established.
 */
export function useConversation(
  workspace: WorkspaceInfo | null,
  self: ProjectMember,
  providers: readonly ProviderSetupItem[],
  providersReady: boolean,
): ConversationModel {
  const [history, setHistory] = useState<readonly TranscriptEntry[]>([]);
  /**
   * The oldest turns the last read left out. Counted from `load()`, never derived from `history`.
   *
   * It survives an `append` on purpose: appending puts a turn at the *end*, so the number of turns
   * missing from the *start* does not change. Recomputing it, or re-reading the whole transcript
   * after every turn, would be the two ways to get this wrong — the first invents a number, the
   * second re-truncates a stream the person is already reading and moves its beginning under them.
   */
  const [omittedEarlierTurns, setOmittedEarlierTurns] = useState(0);
  const [state, setState] = useState<ConversationState>('loading');
  const [nonce, setNonce] = useState(0);
  const [expandedWork, setExpandedWork] = useState<ReadonlySet<string>>(() => new Set());

  /** The turn in flight: what has been typed, what has come back so far. */
  const [live, setLive] = useState<LiveTurn | null>(null);
  const run = useRef<AgentRun | null>(null);

  const root = workspace?.root ?? null;

  // A different folder is a different conversation. Dropping the old entries here rather than only
  // on a successful read matters for the read that *fails*: the alternative leaves the previous
  // project's turns on screen under the new project's name.
  useEffect(() => {
    setHistory([]);
    setOmittedEarlierTurns(0);
  }, [root]);

  useEffect(() => {
    const bridge = window.partyco?.transcript;
    if (!root || !bridge) {
      setHistory([]);
      setOmittedEarlierTurns(0);
      // No workspace is not a failed read — it is an empty conversation, which is what a person
      // sees on their first launch and exactly what the greeting is for.
      setState(root ? 'error' : 'ready');
      return;
    }

    let cancelled = false;
    setState('loading');

    void bridge
      .load()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState('error');
          return;
        }
        setHistory(result.value.items);
        setOmittedEarlierTurns(result.value.omitted);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [root, nonce]);

  // Leaving the shell mid-turn must stop the child, not orphan it. The main process also kills on
  // window destruction; this covers the ordinary case of navigating away.
  useEffect(() => {
    return () => {
      void run.current?.cancel();
      run.current = null;
    };
  }, []);

  const target = useMemo(() => chooseTarget(providers), [providers]);

  const blocked = useMemo(() => {
    if (!workspace) return 'Сначала выбери папку проекта — агенту нужно, где работать.';
    if (!window.partyco?.agents) {
      return 'Агента запускает основной процесс, а он сейчас недоступен.';
    }
    if (!providersReady) return null;
    if (!target) {
      return 'Ни один провайдер здесь не настроен. Открой «Настройки» — там ключ или свой CLI.';
    }
    return null;
  }, [workspace, providersReady, target]);

  /**
   * One turn to disk, and the same turn onto the end of the stream.
   *
   * The transcript is **not** re-read afterwards, and that is what keeps truncation honest across a
   * turn. The main process answers with the entry it stored, including the id it assigned, so the
   * row appended here is the row on disk — not a guess that a re-read would then duplicate. And
   * because nothing is re-read, the turns cut from the *start* stay cut: a new turn at the end
   * cannot resurrect them, and `omittedEarlierTurns` is still exactly how many are missing before
   * `history[0]`.
   */
  const append = useCallback((entry: Omit<TranscriptEntry, 'id' | 'at'>): void => {
    const bridge = window.partyco?.transcript;
    if (!bridge) return;
    void bridge
      .append(entry)
      .then((result) => {
        if (result.ok) setHistory((current) => [...current, result.value]);
      })
      .catch(() => undefined);
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const bridge = window.partyco?.agents;
      if (!trimmed || !workspace || !bridge || !target || run.current) return;

      append({ role: 'member', text: trimmed });
      setLive({ prompt: trimmed, text: '', tools: [] });

      const started = bridge.run(
        {
          providerId: target.providerId,
          mode: target.mode,
          prompt: trimmed,
          cwd: workspace.root,
        },
        (event: AgentEvent) => setLive((current) => (current ? reduce(current, event) : current)),
      );
      run.current = started;

      void started.done
        .catch(() => undefined)
        .finally(() => {
          run.current = null;
          // Read through the setter rather than off a closure: the last events and the resolution
          // of `done` race, and the closure's copy of `live` is from before either.
          setLive((current) => {
            if (current) append(finish(current, target.providerId));
            return null;
          });
        });
    },
    [workspace, target, append],
  );

  const cancel = useCallback(() => {
    void run.current?.cancel();
  }, []);

  const items = useMemo(
    () => buildStream(history, live, self, expandedWork),
    [history, live, self, expandedWork],
  );

  return {
    items,
    state,
    omittedEarlierTurns,
    running: live !== null,
    target,
    blocked,
    send,
    cancel,
    reload: useCallback(() => setNonce((n) => n + 1), []),
    toggleWork: useCallback((id: string) => {
      setExpandedWork((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []),
  };
}

/* ------------------------------------------------------------------ *
 * The turn in flight
 * ------------------------------------------------------------------ */

interface LiveTurn {
  prompt: string;
  text: string;
  tools: readonly WorkStep[];
  error?: string;
  cancelled?: boolean;
}

/**
 * One event folded into the turn.
 *
 * `result.text` replaces the streamed text rather than appending to it: an adapter that emits a
 * final answer is restating the whole thing, and appending would show it twice.
 */
function reduce(turn: LiveTurn, event: AgentEvent): LiveTurn {
  switch (event.kind) {
    case 'text':
      return { ...turn, text: turn.text + event.text };
    case 'tool':
      return {
        ...turn,
        tools: [...turn.tools, { file: event.name, note: event.detail ?? '' }],
      };
    case 'result':
      return event.text !== undefined ? { ...turn, text: event.text } : turn;
    case 'error':
      return { ...turn, error: event.message };
    case 'cancelled':
      return { ...turn, cancelled: true };
    default:
      return turn;
  }
}

/** The turn as it goes to disk. Empty fields are left out so a reload does not read blanks back. */
function finish(turn: LiveTurn, providerId: string): Omit<TranscriptEntry, 'id' | 'at'> {
  return {
    role: 'agent',
    providerId,
    ...(turn.text ? { text: turn.text } : {}),
    ...(turn.tools.length > 0 ? { tools: turn.tools.map(describeTool) } : {}),
    ...(turn.error ? { error: turn.error } : {}),
    ...(turn.cancelled ? { cancelled: true } : {}),
  };
}

function describeTool(step: WorkStep): string {
  return step.note ? `${step.file} · ${step.note}` : step.file;
}

/* ------------------------------------------------------------------ *
 * History and the live turn, as one stream
 * ------------------------------------------------------------------ */

function buildStream(
  history: readonly TranscriptEntry[],
  live: LiveTurn | null,
  self: ProjectMember,
  expandedWork: ReadonlySet<string>,
): readonly ConversationItem[] {
  const items: ConversationItem[] = [];

  for (const entry of history) {
    if (entry.role === 'member') {
      items.push({ kind: 'prompt', id: entry.id, author: self, text: entry.text ?? '' });
      continue;
    }

    if (entry.tools && entry.tools.length > 0) {
      const id = `${entry.id}:work`;
      items.push({
        kind: 'work',
        id,
        summary: summariseTools(entry.tools),
        added: 0,
        removed: 0,
        steps: entry.tools.map(parseTool),
        expanded: expandedWork.has(id),
      });
    }
    if (entry.text) items.push({ kind: 'reply', id: entry.id, text: entry.text });
    // A turn that ended badly, or that the member stopped, still says so on reload. Both are
    // written as a reply because they are the agent's side of the exchange — a person reading back
    // needs to see why the answer stops, not a gap.
    if (entry.error) {
      items.push({ kind: 'reply', id: `${entry.id}:error`, text: entry.error });
    } else if (entry.cancelled && !entry.text) {
      items.push({ kind: 'reply', id: `${entry.id}:cancelled`, text: TURN_STOPPED });
    }
  }

  if (live) {
    items.push({ kind: 'prompt', id: 'live:prompt', author: self, text: live.prompt });
    if (live.tools.length > 0) {
      items.push({
        kind: 'work',
        id: 'live:work',
        summary: summariseTools(live.tools.map(describeTool)),
        added: 0,
        removed: 0,
        steps: live.tools,
        expanded: expandedWork.has('live:work'),
      });
    }
    if (live.text) items.push({ kind: 'reply', id: 'live:reply', text: live.text });
    if (live.error) items.push({ kind: 'reply', id: 'live:error', text: live.error });
    if (!live.error && !live.cancelled) {
      items.push({ kind: 'run', id: 'live:run', label: 'Агент работает' });
    }
  }

  return items;
}

const TURN_STOPPED = 'Ты остановил этот ход. Ничего не сломалось — агент просто не договорил.';

/** «Сделал 4 шага» — a count, because the tool names are one click away and mean little in a row. */
function summariseTools(tools: readonly string[]): string {
  const n = tools.length;
  const word = n % 10 === 1 && n % 100 !== 11 ? 'шаг' : pluralSteps(n);
  return `Сделал ${n} ${word}`;
}

function pluralSteps(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return 'шагов';
  const ones = n % 10;
  return ones >= 2 && ones <= 4 ? 'шага' : 'шагов';
}

/** The inverse of `describeTool`, so a reloaded turn expands to the same rows it had while running. */
function parseTool(line: string): WorkStep {
  const at = line.indexOf(' · ');
  if (at === -1) return { file: line, note: '' };
  return { file: line.slice(0, at), note: line.slice(at + 3) };
}
