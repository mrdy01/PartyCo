/**
 * How a child process is started on this platform — the Windows wrapper problem and nothing else.
 *
 * Its own file because two callers need the same answer and must not each invent one: `engine.ts`
 * starts a turn, `detect.ts` asks a binary for its version. When those two decided separately, a
 * member could be told "installed, version 2.1.220" by one and "cannot be started" by the other,
 * about the same file. It also keeps the dependency graph one-directional — `detect.ts` needs this
 * policy, `engine.ts` needs both this policy and detection.
 *
 * The problem: Windows will not execute a `.cmd` or `.bat` itself. They are scripts for a command
 * interpreter, and Node refuses to start one without a shell (EINVAL — the fix for CVE-2024-27980).
 * npm installs every CLI as exactly that kind of wrapper, so on the platform PartyCo targets first,
 * a member who ran `npm i -g claude` could not start their agent at all. Measured here rather than
 * assumed: spawning the full path of a `.cmd` throws `EINVAL`, and spawning its bare name answers
 * `ENOENT` — libuv's PATH search does not reach the wrapper either.
 *
 * The old refusal was right for the code as it stood: the prompt was an argv element, and routing
 * argv through an interpreter is how a question becomes a command. That premise is gone. The prompt
 * now travels on stdin, so the command line holds only tokens this package wrote, and every one of
 * them is checked three ways before it is assembled:
 *
 *  1. `promptInArgv` must be false. A caller that still needs argv for the prompt is refused here
 *     and keeps failing on `.cmd` — half a safety property is worse than an honest refusal.
 *  2. Every token starting with `-` must be in the caller's own flag list, so an argument that came
 *     from anywhere else cannot ride along as an option.
 *  3. No token may contain a character the interpreter reads as syntax. Not escaped — refused.
 *     Quoting rules for `cmd.exe` differ from the C runtime's and a scheme that is only mostly right
 *     is the whole family of BatBadBut (CVE-2024-24576) bugs. Checked on a real machine: `%VAR%`
 *     expands even inside double quotes, so `%` genuinely cannot be quoted away.
 *
 * Then each token is wrapped in quotes and the whole line is handed to `cmd.exe /d /s /c "…"`, the
 * same form Node itself builds for a shell — `/d` skips AutoRun commands from the registry, `/s`
 * makes the outer quotes the literal delimiters of the command. The `shell` option stays off
 * everywhere: this is one named program with an argument vector we assembled, not a string handed to
 * something to parse.
 */

import path from 'node:path';

/**
 * Extensions Windows can start directly, with no interpreter in the middle. The empty string is the
 * bare-name case (`claude` rather than `…\claude.exe`), which is left to PATH resolution as before.
 */
const WINDOWS_DIRECT_EXTENSIONS: ReadonlySet<string> = new Set(['.exe', '.com', '']);

/** Extensions that are scripts for `cmd.exe`. What npm writes when it installs a CLI. */
const WINDOWS_SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['.cmd', '.bat']);

/**
 * How a given file can be started.
 *
 * `unsupported` is `.ps1` and anything else: PowerShell is a different interpreter with a different
 * quoting model and its own injection surface, and npm does not need it. Adding it would be a second
 * narrow exception to reason about, for no member who is currently stuck.
 */
export type ExecutableKind = 'direct' | 'interpreter' | 'unsupported';

export function executableKind(filePath: string, platform: NodeJS.Platform): ExecutableKind {
  if (platform !== 'win32') return 'direct';
  const ext = path.win32.extname(filePath).toLowerCase();
  if (WINDOWS_DIRECT_EXTENSIONS.has(ext)) return 'direct';
  if (WINDOWS_SCRIPT_EXTENSIONS.has(ext)) return 'interpreter';
  return 'unsupported';
}

/**
 * Characters `cmd.exe` reads as something other than text.
 *
 * `"` would end our own quoting; `%` expands a variable even inside quotes (measured, not assumed);
 * `!` does the same when delayed expansion is on; `^` escapes; `& | < > ( )` separate, pipe, redirect
 * and group; a newline or a NUL ends the command outright. Only `"` and `%` and the line breaks are
 * strictly dangerous once every token is quoted — the rest are here as defence in depth, because
 * nothing in a flag, a model id or an ordinary Windows path contains them, so refusing costs a
 * member nothing while narrowing what a future edit can smuggle through.
 */
const CMD_SYNTAX = /["%!^&|<>()\r\n\u0000]/;

function isCmdSafeToken(token: string): boolean {
  return token.length > 0 && !CMD_SYNTAX.test(token);
}

/**
 * Wrap one token so the interpreter passes it through as a single argument.
 *
 * Trailing backslashes are doubled: `"C:\dir\"` would otherwise end in an escaped quote and swallow
 * the rest of the line. Every other character is safe by the check above, which is the only reason
 * this can be one line instead of a parser.
 */
function quoteForCmd(token: string): string {
  return `"${token.replace(/(\\+)$/, '$1$1')}"`;
}

/**
 * Where Windows keeps its own programs.
 *
 * Built from `SystemRoot` — which `env.ts` allowlists — and never looked up on PATH: a bare
 * `cmd.exe` is a name any PATH entry can answer for, and the whole point of this file is that the
 * program we hand a command line to is the one we meant.
 */
export function systemProgram(systemRoot: string | undefined, name: string): string {
  const root = systemRoot !== undefined && systemRoot.length > 0 ? systemRoot : 'C:\\Windows';
  return path.win32.join(root, 'System32', name);
}

export interface SpawnPlan {
  command: string;
  args: readonly string[];
  /** True only for the interpreter path, where the command line was assembled here deliberately. */
  windowsVerbatimArguments: boolean;
  /** Whether an interpreter stands between us and the CLI. Cancellation has to know. */
  viaInterpreter: boolean;
}

export type SpawnPlanResult = { ok: true; plan: SpawnPlan } | { ok: false; reason: string };

export interface SpawnPlanInput {
  /** Absolute path to the executable, or a bare name left to PATH resolution. */
  command: string;
  args: readonly string[];
  platform: NodeJS.Platform;
  /** True when untrusted text rides in argv. Blocks the interpreter path outright. */
  promptInArgv: boolean;
  /** Every argv token starting with `-` the caller may emit. Nothing else may reach an interpreter. */
  ownFlags: readonly string[];
  /** `SystemRoot` from the built child environment, used to locate `cmd.exe` without searching. */
  systemRoot?: string | undefined;
}

/** Keep a refused argument readable in a message without pasting a whole path into one line. */
function clamp(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Decide how to start this executable, or refuse with a sentence a person can act on.
 *
 * Returns a refusal rather than throwing because every caller turns a failure into something
 * displayed, not into an exception someone has to remember to catch.
 */
export function planSpawn(input: SpawnPlanInput): SpawnPlanResult {
  const { command, args, platform, promptInArgv, ownFlags, systemRoot } = input;
  const kind = executableKind(command, platform);

  if (kind === 'direct') {
    return {
      ok: true,
      plan: { command, args, windowsVerbatimArguments: false, viaInterpreter: false },
    };
  }

  const name = path.win32.basename(command);

  if (kind === 'unsupported') {
    return {
      ok: false,
      reason:
        `«${name}» — сценарий для PowerShell, а PartyCo запускает только программы и обёртки ` +
        `.cmd/.bat. Поставь нативную сборку инструмента или установи его через npm — тогда в PATH ` +
        `появится .cmd, который PartyCo запустить умеет.`,
    };
  }

  if (promptInArgv) {
    return {
      ok: false,
      reason:
        `«${name}» — обёртка, и Windows запускает её только через командный интерпретатор. ` +
        `PartyCo делает это лишь тогда, когда текст запроса уходит в stdin, а не в аргументы. ` +
        `Этот движок передаёт запрос аргументом, поэтому запуск отменён: чужой текст через ` +
        `интерпретатор не проходит никогда.`,
    };
  }

  const allowed = new Set(ownFlags);
  for (const token of args) {
    if (token.startsWith('-') && !allowed.has(token)) {
      return {
        ok: false,
        reason:
          `PartyCo не стал запускать «${name}» через командный интерпретатор: в аргументах оказался ` +
          `флаг «${clamp(token)}», которого движок не собирал. Это защита от подмены аргументов.`,
      };
    }
  }

  for (const token of [command, ...args]) {
    if (!isCmdSafeToken(token)) {
      return {
        ok: false,
        reason:
          `PartyCo не стал запускать «${name}» через командный интерпретатор: в аргументе ` +
          `«${clamp(token)}» есть символ, который интерпретатор Windows читает как команду. ` +
          `Надёжно экранировать такое нельзя, поэтому запуск отменён. Убери из пути символы ` +
          `& | < > ^ % ! ( ) и кавычки — или поставь нативную сборку инструмента.`,
      };
    }
  }

  const line = [command, ...args].map(quoteForCmd).join(' ');
  return {
    ok: true,
    plan: {
      command: systemProgram(systemRoot, 'cmd.exe'),
      // The shape Node itself builds for a shell: `/d` skips registry AutoRun, `/s` makes the outer
      // quotes the delimiters of everything between them.
      args: ['/d', '/s', '/c', `"${line}"`],
      windowsVerbatimArguments: true,
      viaInterpreter: true,
    },
  };
}
