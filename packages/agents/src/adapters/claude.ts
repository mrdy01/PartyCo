/**
 * Anthropic — the delegated Claude Code path.
 *
 * This adapter describes one thing: how to talk to the `claude` binary the member installed and
 * signed into themselves. It builds argv, reads lines, and turns an exit code into a sentence. It
 * does not spawn, does not build an environment, does not read a credential file, and makes no HTTP
 * request. Those absences are the product: `docs/providers-and-subscription-legality.md` §1 records
 * that the surviving pattern in 2026 is "run the vendor's official binary, into which the person
 * logged in themselves", and that everything which forged a client identity or reused a vendor's
 * OAuth client got its *users* banned.
 *
 * Three consequences visible in the code below:
 *
 *  - `buildArgs` emits only flags documented on https://code.claude.com/docs/en/headless and
 *    https://code.claude.com/docs/en/cli-reference. No `--dangerously-*`, no identity headers, and
 *    deliberately no `--bare`: that flag "skips OAuth and keychain reads" and requires
 *    `ANTHROPIC_API_KEY`, i.e. it silently switches the member from the subscription they chose to
 *    metered billing. Which credential source is used is decided by `AuthMode` in `env.ts`, never by
 *    an argument this file invents.
 *  - `parseLine` never surfaces raw tool input. A `Write` call carries a whole file in `input`, an
 *    `Edit` carries both sides of a patch, a `Bash` command can carry a token. Only a short allowlist
 *    of self-describing scalar fields becomes a `detail`, clamped to one line.
 *  - `explainExit` singles out the authentication failure, because it is the one failure with a
 *    remedy — and the remedy is that the person signs in themselves, in the vendor's own binary. We
 *    never show a login screen and never offer to log them in.
 */

import type { AgentAdapter, AgentEvent, AgentRequest, ErrorEvent } from '../engine.ts';

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

/**
 * Make a piece of untrusted text safe to place in argv as a value rather than a flag.
 *
 * `shell: false` stops a prompt from becoming *shell* syntax. It does not stop it from becoming
 * *option* syntax: argv is still parsed by the CLI's own argument parser, and a token whose first
 * character is `-` is an option to every parser there is. Checked against the real `buildArgs`
 * output: a prompt of `--dangerously-skip-permissions` produced
 * `['-p', '--dangerously-skip-permissions', '--output-format', …]`, i.e. the question vanished and a
 * flag that disables every permission prompt got switched on by whoever typed the question. A single
 * token can also carry a value — `--settings=C:\evil.json`, `--mcp-config={…}` — so the attack is not
 * limited to valueless flags.
 *
 * The repair is one leading space. A token starting with a space is not an option to any parser, so
 * it lands where it was meant to land — as the prompt, or as the value of `--model`. A model reading
 * a question with one extra space in front of it behaves identically; a CLI handed an injected flag
 * does not. Claude Code does not document `--` as an end-of-options separator, so this file does not
 * invent one: the space needs no promise from the vendor to work.
 */
function asValue(text: string): string {
  return text.startsWith('-') ? ` ${text}` : text;
}

/**
 * One non-interactive run.
 *
 * `-p` is the documented non-interactive flag ("Print response without interactive mode").
 * `--output-format stream-json` is the documented "newline-delimited JSON for real-time streaming",
 * and `--verbose` accompanies it in every stream-json example the headless page gives — including the
 * one it labels as the way to stream. Passing it is what makes the run emit turn-by-turn objects
 * rather than a single blob.
 *
 * `--include-partial-messages` is documented too and deliberately left out: it adds token-level
 * `stream_event` lines that duplicate the complete `assistant` messages we already read, and the
 * shell renders whole blocks anyway.
 */
export function buildArgs(request: AgentRequest): string[] {
  const args = ['-p', asValue(request.prompt), '--output-format', 'stream-json', '--verbose'];

  // `--model`: "Sets the model for the current session with an alias for the latest model
  // (`sonnet`, `opus`, `haiku`, or `fable`) or a model's full name." Documented on the CLI
  // reference as a general flag, and the headless page states all CLI options work with `-p`.
  const model = request.model?.trim();
  if (model) args.push('--model', asValue(model));

  return args;
}

/* ------------------------------------------------------------------ *
 * Version
 * ------------------------------------------------------------------ */

const SEMVER = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/;

/**
 * `claude --version` prints a line such as `2.1.220 (Claude Code)`.
 *
 * Presence of a version is the *entire* definition of "installed" in PartyCo — we never look inside
 * the vendor's config directory to find out more. Returns `null` rather than guessing when the CLI
 * prints something we do not recognise; a wrong version is worse than an unknown one.
 */
export function parseVersion(stdout: string): string | null {
  return stdout.match(SEMVER)?.[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * Stream parsing
 * ------------------------------------------------------------------ */

const MAX_DETAIL = 120;

const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Credential shapes that must not survive into anything we display or log.
 *
 * `env.ts` guarantees at most one key ever reaches the child. Nothing guaranteed that the key does
 * not come back: in `api-key` mode the CLI is holding the member's key, and a vendor error, a debug
 * banner or a `--verbose` dump can quote the thing that failed to authenticate. Whatever we quote
 * back lands in a transcript a whole party can read and in whatever the shell logs. Same list and
 * same reasoning as `adapters/codex.ts`, which already did this.
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

/**
 * One line, no control characters, no ANSI, no credentials. Everything shown to a person goes
 * through here — the agent's own answer excepted, which is passed through verbatim because
 * rewriting a model's reply would make the transcript lie about what was said.
 */
function collapse(text: string): string {
  return redact(text.replace(ANSI, '')).replace(/\s+/g, ' ').trim();
}

/** Keep the head — for prose, the beginning carries the meaning. */
function clampHead(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Keep the tail — for a path, `…/src/adapters/claude.ts` beats `D:\very\long\repo\packa…`. */
function clampTail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - (max - 1))}`;
}

/**
 * Fields of a tool's `input` that may be shown to a person, and how.
 *
 * This is an allowlist and must stay one. The rule is not "hide the fields we think are secret" —
 * it is "show only the fields that are, by their own definition, a short human-facing label". Adding
 * `content`, `old_string`, `new_string` or `command` here would put file contents or a token on the
 * screen and into whatever the shell logs; `description` exists precisely because the tool schema
 * asks the model for a one-line summary of the command.
 */
function summarizeToolInput(input: unknown): string | null {
  if (!isRecord(input)) return null;

  // Filesystem tools: the path is the useful part.
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = asString(input[key]);
    if (value) return clampTail(collapse(value), MAX_DETAIL);
  }

  // Bash and Task: the model's own one-line description of what it is doing. Never the command.
  const description = asString(input['description']);
  if (description) return clampHead(collapse(description), MAX_DETAIL);

  // Search tools.
  for (const key of ['pattern', 'query']) {
    const value = asString(input[key]);
    if (value) return clampHead(collapse(value), MAX_DETAIL);
  }

  // WebFetch: the host, not the URL — a query string is exactly where a token hides.
  const url = asString(input['url']);
  if (url) {
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  }

  const subagent = asString(input['subagent_type']);
  if (subagent) return clampHead(collapse(subagent), MAX_DETAIL);

  // Nothing on the allowlist matched. Say nothing rather than fall back to the raw object.
  return null;
}

function toolEvent(name: string, input: unknown): AgentEvent {
  const detail = summarizeToolInput(input);
  // `exactOptionalPropertyTypes`: an absent detail is an absent key, not an explicit `undefined`.
  return detail ? { kind: 'tool', name, detail } : { kind: 'tool', name };
}

/** Assistant content is normally a block array, but the wire format also permits a bare string. */
function parseAssistantContent(content: unknown): AgentEvent[] {
  const text = asString(content);
  if (text) {
    const collapsed = text.trim();
    return collapsed ? [{ kind: 'text', text: collapsed }] : [];
  }
  if (!Array.isArray(content)) return [];

  const events: AgentEvent[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const type = asString(block['type']);

    if (type === 'text') {
      const value = asString(block['text'])?.trim();
      if (value) events.push({ kind: 'text', text: value });
      continue;
    }

    if (type === 'tool_use') {
      const name = asString(block['name'])?.trim();
      if (name) events.push(toolEvent(name, block['input']));
      continue;
    }

    // `thinking` / `redacted_thinking`: the member asked for an answer, not for the reasoning, and
    // the signatures are opaque. Dropped on purpose.
  }
  return events;
}

/**
 * Turn one line of `--output-format stream-json` into events.
 *
 * Contract from `engine.ts`: never throw, and treat unparseable output as ordinary. A CLI is free to
 * print a deprecation notice, a progress bar, or a blank line on any release, and none of that is an
 * error — so anything that is not a JSON object we recognise yields `[]`.
 *
 * Deliberately ignored message types:
 *  - `user` — carries `tool_result` blocks, i.e. whatever the tool read. Surfacing those would leak
 *    file contents through the event stream.
 *  - `system` (`init`, `api_retry`, `plugin_install`, `compact_boundary`) — session bookkeeping.
 *  - `stream_event` — only appears with `--include-partial-messages`, which we do not pass.
 */
export function parseLine(line: string): AgentEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];

  const type = asString(parsed['type']);

  if (type === 'assistant') {
    const message = parsed['message'];
    if (!isRecord(message)) return [];
    return parseAssistantContent(message['content']);
  }

  if (type === 'result') return parseResult(parsed);

  return [];
}

/**
 * The last line of the stream.
 *
 * Success carries the final answer in `result`. Failure carries `is_error: true` and/or a `subtype`
 * of `error_max_turns` / `error_during_execution` — and in that case the explanation lives here, on
 * stdout, while stderr may be empty. So this is reported as an error rather than passed off to
 * `explainExit`, which would only be able to say "exit code 1".
 */
function parseResult(parsed: Record<string, unknown>): AgentEvent[] {
  const subtype = asString(parsed['subtype']);
  const isError = parsed['is_error'] === true || (subtype !== null && subtype.startsWith('error'));
  const text = asString(parsed['result'])?.trim() ?? '';

  if (!isError) {
    // `result` is `unknown` on the wire — with `--json-schema` it is an object. Only a plain string
    // is an answer a person can read; anything else is reported as a bare completion.
    return text ? [{ kind: 'result', text }] : [{ kind: 'result' }];
  }

  if (looksLikeAuthFailure(text)) {
    return [{ kind: 'error', message: AUTH_REMEDY, authFailed: true }];
  }

  if (subtype === 'error_max_turns') {
    return [
      {
        kind: 'error',
        message:
          'Claude Code остановился, не закончив: исчерпан лимит шагов за один запуск. ' +
          'Разбей задачу на части поменьше и попроси ещё раз.',
      },
    ];
  }

  const tail = text ? ` ${clampHead(collapse(text), 300)}` : '';
  return [{ kind: 'error', message: `Claude Code прервался во время работы.${tail}`.trim() }];
}

/* ------------------------------------------------------------------ *
 * Exits
 * ------------------------------------------------------------------ */

/**
 * The remedy for an auth failure, and the only thing we are allowed to do about it.
 *
 * PartyCo does not show a Claude.ai login, does not run an OAuth flow, and does not hand the CLI a
 * token. The person signs into the vendor's binary themselves — that is what makes this transport
 * survivable at all (see the legality doc, §1.1 and §5.1).
 */
const AUTH_REMEDY =
  'Claude Code не авторизован — он не смог подтвердить, что ты вошёл. ' +
  'Войди сам: запусти в терминале `claude` и выполни `/login`. ' +
  'PartyCo не видит твой логин и не может войти за тебя.';

/**
 * Markers of "this run failed because of who you are, not what you asked".
 *
 * The first entry is the one from practice: in January 2026 Anthropic began checking client identity
 * server-side and subscription tokens used outside the official client started answering
 * "This credential is only authorized for use with Claude Code and cannot be used for other API
 * requests." The rest are the ordinary shapes — including `authentication_failed`, which the headless
 * docs list as an `error` category on the `system/api_retry` event.
 */
const AUTH_MARKERS: readonly RegExp[] = [
  /this credential is only authorized for use with claude code/i,
  /authentication[_ ]?(?:error|failed|failure)/i,
  /\bunauthorized\b/i,
  /invalid bearer token/i,
  /invalid x-api-key/i,
  /\bnot logged ?in\b/i,
  /\bplease (?:run )?\/login\b/i,
  /\blog ?in to claude\b/i,
  /oauth[_ ]?token (?:has )?expired/i,
  /credentials? (?:are )?(?:invalid|expired)/i,
  /\bsession (?:has )?expired\b/i,
  // A bare `401` needs company: on its own it is as likely to be a line number as a status. Every
  // form Anthropic actually prints puts a word in front of it.
  /(?:error|status|code|http|failed with)\D{0,12}\b401\b/i,
  /\b401\b\D{0,12}(?:unauthor|forbidden|authentic)/i,
];

/** Org policy refused this account. Still an auth failure, but the person cannot fix it alone. */
const ORG_MARKER = /oauth[_ ]?org[_ ]?not[_ ]?allowed/i;

export function looksLikeAuthFailure(text: string): boolean {
  return AUTH_MARKERS.some((marker) => marker.test(text));
}

/** The most informative single line of stderr, cleaned up for display. */
function summarizeStderr(stderr: string): string {
  const lines = stderr
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return '';

  const pointed = lines.find((line) => /error|invalid|fail|denied|refus/i.test(line));
  const chosen = pointed ?? lines[lines.length - 1] ?? '';
  return clampHead(collapse(chosen), 300);
}

/**
 * Turn a non-zero exit into something a person can act on.
 *
 * Every branch answers two questions in ordinary words — what happened, and what to do — because the
 * alternative ("exit code 1") makes a member open a terminal to find out what their own tool did.
 */
export function explainExit(code: number | null, stderr: string): ErrorEvent {
  const text = stderr.replace(ANSI, '');
  const summary = summarizeStderr(stderr);

  if (ORG_MARKER.test(text)) {
    return {
      kind: 'error',
      message:
        'Anthropic не разрешает этому аккаунту работать так — ограничение стоит на стороне ' +
        'организации, к которой привязан твой логин. Тут поможет только администратор организации.',
      authFailed: true,
    };
  }

  if (looksLikeAuthFailure(text)) {
    return { kind: 'error', message: AUTH_REMEDY, authFailed: true };
  }

  // Documented: a `-p` run stopped with SIGTERM "aborts the in-progress turn … and exits with code
  // 143". `null` means we killed it ourselves through the abort signal.
  if (code === 143 || code === null) {
    return { kind: 'error', message: 'Запуск Claude Code остановлен, ответ не готов.' };
  }

  if (/command not found|is not recognized as an internal|ENOENT/i.test(text)) {
    return {
      kind: 'error',
      message:
        'Claude Code не найден на этой машине. Установи его и войди сам — PartyCo запускает ' +
        'только тот CLI, который уже стоит у тебя.',
    };
  }

  if (/rate[_ ]?limit|\b429\b|usage limit|too many requests/i.test(text)) {
    return {
      kind: 'error',
      message: summary
        ? `Anthropic притормозил запросы, лимит на время исчерпан: ${summary} Подожди и повтори.`
        : 'Anthropic притормозил запросы: лимит на время исчерпан. Подожди и повтори.',
    };
  }

  if (/credit balance is too low|billing|insufficient[_ ]?quota|payment/i.test(text)) {
    return {
      kind: 'error',
      message:
        'Anthropic отказал по оплате: на аккаунте, под которым работает Claude Code, ' +
        'закончились средства или лимит плана. Проверь свой аккаунт у Anthropic.',
    };
  }

  if (/\b(?:529|503)\b|overloaded|service unavailable/i.test(text)) {
    return {
      kind: 'error',
      message: 'Серверы Anthropic сейчас перегружены и не ответили. Стоит повторить через минуту.',
    };
  }

  if (/model[_ ]?not[_ ]?found|unknown model|invalid model/i.test(text)) {
    return {
      kind: 'error',
      message: summary
        ? `Claude Code не знает такую модель: ${summary} Выбери другую в настройках движка.`
        : 'Claude Code не знает такую модель. Выбери другую в настройках движка.',
    };
  }

  if (summary) {
    return { kind: 'error', message: `Claude Code завершился с ошибкой: ${summary}` };
  }

  return {
    kind: 'error',
    message:
      `Claude Code завершился, ничего не объяснив (код ${code}). ` +
      'Попробуй запустить `claude` в терминале в той же папке — он скажет, что не так.',
  };
}

/* ------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------ */

export const claudeAdapter: AgentAdapter = {
  providerId: 'anthropic',
  binary: 'claude',
  versionArgs: ['--version'],
  parseVersion,
  buildArgs,
  parseLine,
  explainExit,
};
