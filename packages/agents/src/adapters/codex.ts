/**
 * OpenAI Codex, driven through its documented non-interactive mode.
 *
 * Of the three vendors this is the only one that wrote down "embed us in your product" as a
 * supported scenario rather than leaving it to inference: `codex app-server`, the Codex SDK and
 * `codex exec` are all documented integration surfaces
 * (https://developers.openai.com/codex/ — now served from https://learn.chatgpt.com/docs).
 * `exec` is the smallest of the three and the one that fits `AgentAdapter`: one prompt in, a stream
 * of JSONL events out, process exits. `app-server` is the next step and is deliberately *not* this
 * file — see the note at the bottom.
 *
 * What this adapter is allowed to know about authentication: nothing. The member ran `codex login`
 * themselves, in their own terminal, against their own account. We do not read `~/.codex/auth.json`,
 * we do not refresh a token, we do not stand up an OAuth client against `auth.openai.com`, and we do
 * not set `originator` — Codex's own value is `codex_cli_rs` and forging it is precisely the thing
 * proxies do and vendors detect. Every one of those is a policy violation, not a shortcut we skipped
 * for time. See `docs/providers-and-subscription-legality.md` §1.2 and §2 level B1.
 *
 * Structurally this file is pure: it builds argument arrays and turns strings into events. It never
 * spawns (that is `engine.ts`), never builds an environment (that is `env.ts`), and never decides
 * whether the transport is permitted (that is `policy.ts`).
 */

import type { AgentAdapter, AgentEvent, AgentRequest, ErrorEvent, ToolEvent } from '../engine.ts';

/* ------------------------------------------------------------------ *
 * Small, total helpers
 *
 * Everything below treats parsed JSON as `unknown` and narrows explicitly. `parseLine` is fed
 * whatever the CLI happened to print on whatever version the member installed, so "the field is
 * there and is a string" is a hypothesis to test, never an assumption to index on.
 * ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Credential shapes that must never survive into a message we show or log.
 *
 * A vendor error is quoted back to the member so they can act on it, and a vendor error can quote
 * the thing that failed to authenticate. `env.ts` guarantees at most one key ever reaches the child;
 * this guarantees that key does not come back out through an error string.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9._-]{8,}/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9._-]{16,}/g, // JWT
];

function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '<скрыто>');
  return out;
}

/** Collapse to one line and cap length — `detail` lands in a single row of a transcript. */
function short(text: string, limit = 120): string {
  const flat = redact(text).replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

function tool(name: string, detail: string | null): ToolEvent {
  // `exactOptionalPropertyTypes`: omit the key rather than assigning `undefined`.
  return detail === null ? { kind: 'tool', name } : { kind: 'tool', name, detail };
}

/* ------------------------------------------------------------------ *
 * Auth vs. everything else
 * ------------------------------------------------------------------ */

/**
 * Strings that mean "the member is not signed in", across the several layers that can say so:
 * the HTTP status Codex relays, the OpenAI error body, and Codex's own pre-flight complaint.
 */
const AUTH_MARKERS: readonly RegExp[] = [
  /\b401\b/,
  /\bunauthorized\b/i,
  /\bnot\s+(?:logged|signed)\s+in\b/i,
  /\bno\s+auth\s+credentials\b/i,
  /\bauthentication[_ ]?error\b/i,
  /\bauthentication\s+(?:failed|required)\b/i,
  /\binvalid[_ ]api[_ ]key\b/i,
  /\bcodex\s+login\b/i,
  /\b(?:token|credentials?|session)\b[^.\n]{0,40}\bexpired\b/i,
  /\bexpired\b[^.\n]{0,40}\b(?:token|credentials?|session)\b/i,
];

/**
 * Quota is checked *after* auth and kept separate on purpose.
 *
 * "You are out of budget" and "you are not signed in" have opposite remedies, and telling a member
 * to re-run `codex login` when their plan simply ran dry sends them to reauthenticate a working
 * account — the one action most likely to make things worse.
 */
const QUOTA_MARKERS: readonly RegExp[] = [
  /\b429\b/,
  /\brate[_ ]?limit/i,
  /\busage\s+limit/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota\b/i,
];

function looksLikeAuthFailure(text: string): boolean {
  return AUTH_MARKERS.some((pattern) => pattern.test(text));
}

function looksLikeQuotaFailure(text: string): boolean {
  return QUOTA_MARKERS.some((pattern) => pattern.test(text));
}

/** The one remedy sentence, written once so the wording cannot drift between call sites. */
const LOGIN_REMEDY =
  'Войди в Codex сам: запусти в терминале `codex login` ' +
  '(или `codex login --device-auth`, если на этой машине нет браузера). ' +
  'PartyCo не показывает окно входа OpenAI, не хранит и не читает твои учётные данные — ' +
  'вход целиком остаётся между тобой и OpenAI.';

function authError(detail: string | null): ErrorEvent {
  const tail = detail === null ? '' : ` Codex сообщил: ${short(detail, 200)}`;
  return {
    kind: 'error',
    message: `Codex не авторизован — OpenAI отклонила запрос.${tail} ${LOGIN_REMEDY}`,
    authFailed: true,
  };
}

/**
 * Turn a vendor-supplied failure string into an event, routing the auth case to its own remedy.
 * Shared by `parseLine` (structured `error` / `turn.failed` events) and `explainExit` (stderr), so a
 * failure is classified the same way whichever channel it arrived on.
 */
function failure(detail: string): ErrorEvent {
  if (looksLikeAuthFailure(detail)) return authError(detail);
  if (looksLikeQuotaFailure(detail)) {
    return {
      kind: 'error',
      message:
        `Codex остановлен ограничением тарифа, а не ошибкой входа: ${short(detail, 200)} ` +
        'Подожди и повтори — перелогиниваться не нужно.',
    };
  }
  return { kind: 'error', message: `Codex сообщил об ошибке: ${short(detail, 300)}` };
}

/* ------------------------------------------------------------------ *
 * Tool details
 * ------------------------------------------------------------------ */

const SHELL_WRAPPERS: ReadonlySet<string> = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
]);

function baseName(token: string): string {
  const unquoted = token.replace(/^["']+/, '').replace(/["']+$/, '');
  return unquoted.split(/[\\/]/).pop() ?? unquoted;
}

/**
 * Reduce a shell command to the name of the program it runs.
 *
 * This is the one place where the "never raw arguments" rule bites hardest, because for a shell
 * call the arguments *are* the interesting part. They are also where a secret would be: Codex hands
 * us strings like `bash -lc "curl -H 'Authorization: Bearer …' …"`, and putting that in a transcript
 * that a whole party can read is exactly the leak this package exists to prevent. Truncation does
 * not help — a secret at the front survives it.
 *
 * So we keep the verb and drop the rest: `bash -lc ls` becomes `ls`, `bash -lc "npm test"` becomes
 * `npm`. That is a short human string, it cannot carry a credential, and it answers the question a
 * person actually has while watching an agent work, which is "what is it doing right now".
 *
 * This is the Codex counterpart of the Claude adapter's rule that a tool's `command` is never shown
 * and only the model's own one-line `description` is. Codex emits no such description, so the
 * program name is the most informative thing available that is safe by construction.
 */
function commandLabel(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter((token) => token.length > 0);
  let index = 0;

  const first = tokens[0];
  if (first !== undefined && SHELL_WRAPPERS.has(baseName(first).toLowerCase())) {
    index = 1;
    // Skip the wrapper's own switches (`-lc`, `-c`, `/c`, `-Command`, …) to reach the real program.
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === undefined) break;
      if (token.startsWith('-') || token.startsWith('/')) {
        index += 1;
        continue;
      }
      break;
    }
  }

  const program = tokens[index];
  if (program === undefined) return null;
  const label = baseName(program);
  return label.length > 0 ? short(label, 40) : null;
}

/** `command` is a string in current releases; tolerate an argv array in case that changes. */
function readCommand(value: unknown): string | null {
  const direct = asString(value);
  if (direct !== null) return direct;
  if (!Array.isArray(value)) return null;
  const parts = value.filter((part): part is string => typeof part === 'string');
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Paths are the canonical safe `detail` — they are what a person wants and carry no secret. */
function fileChangeDetail(item: Record<string, unknown>): string | null {
  const changes = item['changes'];
  if (!Array.isArray(changes) || changes.length === 0) return null;

  const paths: string[] = [];
  for (const entry of changes) {
    const record = asRecord(entry);
    const path = record === null ? null : asString(record['path']);
    if (path !== null) paths.push(path);
    if (paths.length === 3) break;
  }
  if (paths.length === 0) return `изменений: ${changes.length}`;

  const rest = changes.length - paths.length;
  return rest > 0 ? `${paths.join(', ')} и ещё ${rest}` : paths.join(', ');
}

function todoDetail(item: Record<string, unknown>): string | null {
  const items = item['items'];
  if (!Array.isArray(items) || items.length === 0) return null;
  const done = items.filter((entry) => asRecord(entry)?.['completed'] === true).length;
  return `план: ${done}/${items.length}`;
}

/* ------------------------------------------------------------------ *
 * The JSONL stream
 * ------------------------------------------------------------------ */

/**
 * One thread item, at one point in its life.
 *
 * The mapping rule: items that have a lifecycle (`command_execution`, `mcp_tool_call`) are reported
 * when they *start*, because the value of a tool event is watching work happen; items that only ever
 * arrive complete are reported then. `parseLine` sees one line at a time and holds no state, so
 * emitting on both edges would double every entry with no way to collapse them — the exception is a
 * failed lifecycle item, which is worth the second line.
 */
function parseItem(phase: string, item: Record<string, unknown> | null): AgentEvent[] {
  if (item === null) return [];
  const itemType = asString(item['type']);
  if (itemType === null) return [];

  const started = phase === 'item.started';
  const completed = phase === 'item.completed';
  const failed = completed && asString(item['status']) === 'failed';

  switch (itemType) {
    case 'agent_message': {
      if (!completed) return [];
      const text = asString(item['text']);
      return text === null ? [] : [{ kind: 'text', text }];
    }

    case 'reasoning':
      // Deliberately dropped. `AgentEvent` has no kind for private deliberation, and routing it to
      // `text` would put words in the agent's mouth — the transcript would claim it *said* things it
      // only thought. See `asks` in the handoff report.
      return [];

    case 'command_execution': {
      if (!started && !failed) return [];
      const command = readCommand(item['command']);
      const label = command === null ? null : commandLabel(command);
      // `name` is the tool, `detail` is the human label — the same split the Claude adapter uses, so
      // a shell that groups events by `name` sees one "shell" bucket per provider rather than one
      // bucket per program the agent happened to run.
      if (failed) return [tool('shell', label === null ? 'не удалось' : `${label} — не удалось`)];
      return [tool('shell', label)];
    }

    case 'mcp_tool_call': {
      if (!started && !failed) return [];
      const server = asString(item['server']);
      const toolName = asString(item['tool']);
      // `item.arguments` is never read: it is raw tool input and may carry anything.
      const name = server !== null && toolName !== null ? `${server}/${toolName}` : (toolName ?? 'mcp');
      return [tool(short(name, 60), failed ? 'не удалось' : null)];
    }

    case 'file_change': {
      if (!completed) return [];
      return [tool('file_change', fileChangeDetail(item))];
    }

    case 'web_search': {
      if (!completed) return [];
      const query = asString(item['query']);
      return [tool('web_search', query === null ? null : short(query, 80))];
    }

    case 'todo_list': {
      if (!completed) return [];
      return [tool('todo_list', todoDetail(item))];
    }

    case 'error': {
      // Item-level `error` is documented as a non-fatal warning, but `ErrorEvent` is the only channel
      // available for it. Surfacing it beats swallowing it: a run that silently dropped a warning is
      // a bug report a week later. `turn.failed` still arrives separately if the turn actually dies.
      if (!completed) return [];
      const message = asString(item['message']);
      return message === null ? [] : [failure(message)];
    }

    default:
      // A future Codex release may add item types. Ignoring them is correct: an unknown item is not
      // an error, and inventing an event for it would misreport what happened.
      return [];
  }
}

function parseLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  // `--json` makes stdout pure JSONL, but a banner or a stray warning must not become an exception.
  if (trimmed.length === 0 || trimmed[0] !== '{') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const event = asRecord(parsed);
  if (event === null) return [];
  const type = asString(event['type']);
  if (type === null) return [];

  switch (type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return parseItem(type, asRecord(event['item']));

    case 'turn.completed':
      // The final answer already streamed out as an `agent_message` text event, and Codex puts only
      // token usage here — so this is a terminator, not a second copy of the answer.
      return [{ kind: 'result' }];

    case 'turn.failed': {
      const message = asString(asRecord(event['error'])?.['message']);
      return [message === null ? { kind: 'error', message: 'Codex прервал ход без объяснения.' } : failure(message)];
    }

    case 'error': {
      const message = asString(event['message']);
      return [message === null ? { kind: 'error', message: 'Codex сообщил об ошибке без текста.' } : failure(message)];
    }

    default:
      // `thread.started`, `turn.started`, and whatever a later release adds.
      return [];
  }
}

/* ------------------------------------------------------------------ *
 * Process shape
 * ------------------------------------------------------------------ */

/**
 * Build one non-interactive run.
 *
 * Every flag here is from the published reference (https://learn.chatgpt.com/docs/non-interactive-mode
 * and the CLI reference). Notably absent, each for a reason:
 *
 * - `--dangerously-bypass-approvals-and-sandbox` / `--yolo` — removes the sandbox entirely.
 * - `--skip-git-repo-check` — PartyCo runs agents inside git worktrees, so the check passes on its
 *   own. Passing the flag would only disable a guard that stops an agent writing somewhere with no
 *   way to undo it.
 * - `--ephemeral` — the member's session history is theirs; we do not quietly stop Codex writing it.
 * - `--output-last-message` — would make the adapter touch the filesystem. The final message already
 *   arrives on the stream.
 *
 * The prompt is not here. It goes to stdin, which the vendor documents: "If you omit the prompt
 * argument, Codex reads the prompt from stdin. Use `codex exec -` when you want to force that
 * behavior explicitly." We use the explicit form — `-` after the `--` separator, so it is a
 * positional value and cannot be mistaken for an option — and then write the question and close the
 * stream. See `promptDelivery` at the bottom of this file.
 */
/**
 * `request.agentMode` is ignored here, and that is a decision rather than an oversight.
 *
 * Codex has no `--permission-mode`. What it has is `--sandbox`, and the two are different axes:
 * one is *who approves an edit*, the other is *what the process may touch at all*. Mapping «План»
 * onto `--sandbox read-only` would read plausibly and be wrong — it would mean the mode chip
 * silently widens or narrows a vendor sandbox, which the note below already says is not this
 * adapter's call to make permanently.
 *
 * So the chip does not quietly do nothing here either: `ProviderCapability` reports that this
 * provider accepts no modes, and the menu says so in words instead of offering three rows that
 * change the argv not at all. A test asserts this argv is byte-identical with and without the field.
 */
function buildArgs(request: AgentRequest): string[] {
  const args = [
    'exec',
    // Newline-delimited JSON events instead of formatted text.
    '--json',
    // No ANSI escapes to strip back out before parsing.
    '--color',
    'never',
    // Pin the agent's root to the member's worktree explicitly. `engine.ts` already sets the child's
    // cwd; stating it again means the two cannot drift apart, and it is what bounds `workspace-write`.
    '--cd',
    request.cwd,
    // The documented middle tier: edit inside the workspace, nothing wider. Not the adapter's call to
    // make permanently — see `asks`.
    '--sandbox',
    'workspace-write',
  ];

  if (request.model !== undefined && request.model.length > 0) {
    // A token whose first character is `-` is an option to clap, so a model of
    // `--dangerously-bypass-approvals-and-sandbox` would be read as a flag rather than as a value.
    // One leading space makes it a value again, and a model id that needed the space was never
    // going to resolve anyway — Codex answers with "unknown model", which is the honest outcome.
    // The prompt no longer needs this treatment; a model id, which must sit on the command line,
    // still does.
    args.push('--model', request.model.startsWith('-') ? ` ${request.model}` : request.model);
  }

  // `--` ends option parsing, `-` is the documented sentinel for "the prompt is on stdin". Keeping
  // the separator costs nothing and means a future release cannot reinterpret a lone `-` as a flag.
  args.push('--', '-');
  return args;
}

/**
 * Every flag this file can emit, for the Windows interpreter check in `planSpawn`.
 *
 * `--` and `-` are in the list because they begin with a hyphen and are therefore checked like any
 * other option token. Written out rather than derived from `buildArgs`, because a list derived from
 * the thing it guards would agree with any change made to it — including a mistaken one.
 */
export const OWN_FLAGS: readonly string[] = [
  '--json',
  '--color',
  '--cd',
  '--sandbox',
  '--model',
  '--',
  '-',
];

/**
 * Explain a non-zero exit.
 *
 * `stderr` is the member's own terminal output quoted back at them, so it is redacted and trimmed
 * before it goes anywhere near a message. The auth case is separated because it is the only failure
 * with an action attached, and because the shell needs to know without reading Russian prose.
 */
function explainExit(code: number | null, stderr: string): ErrorEvent {
  const text = stderr.trim();
  const excerpt = text.length === 0 ? null : short(text.slice(-1200), 300);

  if (looksLikeAuthFailure(text)) return authError(excerpt);

  if (code === null) {
    return {
      kind: 'error',
      message:
        'Codex остановлен до завершения — процесс был убит, обычно это отмена задачи.' +
        (excerpt === null ? '' : ` Последнее, что он написал: ${excerpt}`),
    };
  }

  if (looksLikeQuotaFailure(text)) {
    return {
      kind: 'error',
      message:
        `Codex остановлен ограничением тарифа, а не ошибкой входа (код ${code}).` +
        (excerpt === null ? '' : ` ${excerpt}`) +
        ' Подожди и повтори — перелогиниваться не нужно.',
    };
  }

  return {
    kind: 'error',
    message:
      `Codex завершился с кодом ${code}.` +
      (excerpt === null
        ? ' В stderr ничего не было — запусти ту же задачу в терминале, чтобы увидеть подробности.'
        : ` ${excerpt}`),
  };
}

/* ------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------ */

/**
 * `providerId` and `binary` must agree with the `openai` entry in `policy.ts` — that entry is what
 * `runAgent` consults to decide whether this transport may run at all, and it records OpenAI's
 * status as `documented-embedding`.
 *
 * Next step, not this file: `codex app-server` (JSON-RPC over stdio) is the surface OpenAI
 * documents for "deep integration inside your own product" — conversation history, approvals and
 * streamed events. `exec` gives one prompt and one exit, which is the right shape for `AgentAdapter`
 * and the wrong shape for an interactive session a member can steer mid-run. When PartyCo needs
 * that, it needs a second engine alongside `runAgent`, not a bigger adapter.
 */
export const codexAdapter: AgentAdapter = {
  providerId: 'openai',
  binary: 'codex',
  /**
   * Documented in the vendor's own words on the non-interactive-mode page: "If you omit the prompt
   * argument, Codex reads the prompt from stdin. Use `codex exec -` when you want to force that
   * behavior explicitly." The same page describes the other half of the contract we deliberately do
   * not use — "If stdin is piped and you also provide a prompt argument, Codex treats the prompt as
   * the instruction and the piped content as additional context" — which is why `buildArgs` passes
   * no prompt argument at all: with one, the member's question would arrive as *context* to an
   * instruction we invented.
   */
  promptDelivery: 'stdin',
  ownFlags: OWN_FLAGS,
  buildArgs,
  parseLine,
  explainExit,
};
