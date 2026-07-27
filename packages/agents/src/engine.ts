/**
 * The shared vocabulary every provider adapter implements, and the one place a child process is
 * actually started.
 *
 * Written before the adapters on purpose. When the merge-queue screen was built the shared model
 * came first and six panels stayed in agreement; when it did not, two overlapping fixture sets had
 * to be deleted. The same reasoning applies harder here, because the thing the adapters have to
 * agree about is not layout — it is which credential material reaches a child process.
 *
 * Adapters describe **how to talk to one CLI**: what to call it, which arguments to build, how to
 * read a line of its output. They do not spawn, do not build environments, and do not decide whether
 * a transport is permitted. Those three live here and in `env.ts` / `policy.ts`, so there is exactly
 * one code path to audit.
 */

import { spawn } from 'node:child_process';
import { assertNoLeakedCredentials, buildAgentEnv, type AuthMode } from './env.ts';
import { checkAllowed, findProvider } from './policy.ts';

/* ------------------------------------------------------------------ *
 * What comes out of a run
 * ------------------------------------------------------------------ */

/** The agent said something to the person. */
export interface TextEvent {
  kind: 'text';
  text: string;
}

/** The agent used a tool. Deliberately coarse — the shell collapses this to one line anyway. */
export interface ToolEvent {
  kind: 'tool';
  name: string;
  /** Short human summary, e.g. a file path. Never the raw arguments — those can carry secrets. */
  detail?: string;
}

/** Terminal success. `text` is the final answer when the CLI distinguishes one. */
export interface ResultEvent {
  kind: 'result';
  text?: string;
}

/**
 * Terminal failure, already turned into a sentence a person can act on.
 *
 * `authFailed` is separated because it is the one failure with a specific remedy — sign into the
 * vendor's CLI yourself — and because the shell must be able to say so without parsing prose.
 */
export interface ErrorEvent {
  kind: 'error';
  message: string;
  authFailed?: boolean;
}

/**
 * The member stopped the turn themselves.
 *
 * Separate from `ErrorEvent` because a killed child exits non-zero and would otherwise be reported as
 * a failure — the person who pressed stop would get a red error for doing what they meant to do.
 * Nothing went wrong here, so nothing should look like it did.
 */
export interface CancelledEvent {
  kind: 'cancelled';
}

export type AgentEvent = TextEvent | ToolEvent | ResultEvent | ErrorEvent | CancelledEvent;

/* ------------------------------------------------------------------ *
 * What goes in
 * ------------------------------------------------------------------ */

export interface AgentRequest {
  /** What the person asked for. */
  prompt: string;
  /** Absolute path the agent may work in — the member's worktree. */
  cwd: string;
  /** Model as the vendor names it. Omitted means "whatever the CLI is configured for". */
  model?: string;
}

/**
 * One CLI, described.
 *
 * Every method is pure except by construction — an adapter never touches the filesystem, the network,
 * or `process.env`. That keeps the security-relevant surface in this file and makes adapters trivial
 * to test with plain strings.
 */
export interface AgentAdapter {
  providerId: string;
  /** Executable name, resolved on PATH. Never an absolute path baked in at build time. */
  binary: string;
  /** Arguments that make the CLI print its version and exit. */
  versionArgs: readonly string[];
  parseVersion(stdout: string): string | null;
  /** Arguments for one non-interactive run. Must not include any credential. */
  buildArgs(request: AgentRequest): string[];
  /** Turn one line of stdout into zero or more events. Must not throw on malformed input. */
  parseLine(line: string): AgentEvent[];
  /** Turn a non-zero exit into a sentence, flagging the auth case. */
  explainExit(code: number | null, stderr: string): ErrorEvent;
}

export interface RunOptions {
  adapter: AgentAdapter;
  request: AgentRequest;
  mode: AuthMode;
  /** Required for `api-key` mode, forbidden for `subscription` — enforced in `buildAgentEnv`. */
  apiKey?: string;
  signal?: AbortSignal;
  /**
   * Absolute path to the executable, as resolved by `detectCli`.
   *
   * Worth passing: on Windows a bare name finds nothing when only an npm `.cmd` shim is installed,
   * and the resulting `ENOENT` reads as "not installed" for something that is. Falls back to the
   * adapter's bare binary name, which is what PATH resolution does everywhere else.
   */
  binaryPath?: string;
  /** Injectable for tests. Defaults to `node:child_process.spawn`. */
  spawnFn?: typeof spawn;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run one agent turn and stream its events.
 *
 * The ordering here is the contract: policy is checked before an environment is built, the
 * environment is asserted clean before a process exists, and the process is started with
 * `shell: false` so the prompt can never be interpreted by a shell. A prompt is untrusted text —
 * it comes from a person and may quote anything — and it is passed as an argv element, never
 * interpolated into a command line.
 */
export async function* runAgent(options: RunOptions): AsyncGenerator<AgentEvent> {
  const { adapter, request, mode, apiKey, signal, binaryPath, spawnFn = spawn, env: source } = options;

  const verdict = checkAllowed(adapter.providerId, 'local-agent-cli');
  if (!verdict.allowed) {
    yield { kind: 'error', message: verdict.reason };
    return;
  }

  const provider = findProvider(adapter.providerId);
  if (!provider) {
    yield { kind: 'error', message: `Провайдер «${adapter.providerId}» не поддерживается.` };
    return;
  }

  let childEnv: Record<string, string>;
  try {
    childEnv = buildAgentEnv({
      providerId: adapter.providerId,
      mode,
      ...(apiKey ? { apiKey } : {}),
      ...(source ? { source } : {}),
    });
    assertNoLeakedCredentials(childEnv, mode === 'api-key' ? provider.apiKeyEnv : undefined);
  } catch (cause) {
    yield { kind: 'error', message: cause instanceof Error ? cause.message : String(cause) };
    return;
  }

  let child: ReturnType<typeof spawn>;
  try {
    child = spawnFn(binaryPath ?? adapter.binary, adapter.buildArgs(request), {
      cwd: request.cwd,
      env: childEnv,
      // No shell. The prompt is untrusted text and must never reach a command interpreter.
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    // Windows throws EINVAL synchronously for a `.cmd` shim rather than emitting 'error', so a
    // listener alone would never see it and the run would hang instead of failing.
    yield { kind: 'error', message: describeSpawnFailure(adapter.binary, cause as Error) };
    return;
  }

  const queue: AgentEvent[] = [];
  let done = false;
  let wake: (() => void) | null = null;
  /**
   * Whether the stream already carried a failure. A CLI that reports an error in its own output then
   * exits non-zero would otherwise produce two errors for one problem — the adapter's precise one,
   * then a generic one derived from the exit code.
   */
  let reportedError = false;
  /** Set before we kill the child, so its non-zero exit is read as a stop rather than a crash. */
  let cancelled = false;
  const push = (event: AgentEvent) => {
    if (event.kind === 'error') reportedError = true;
    queue.push(event);
    wake?.();
  };

  let stderr = '';
  let stdoutRest = '';

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdoutRest += chunk;
    const lines = stdoutRest.split(/\r?\n/);
    stdoutRest = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      // A malformed line must not kill the run — the CLI may print anything on any release.
      try {
        for (const event of adapter.parseLine(line)) push(event);
      } catch {
        /* ignore unparseable output */
      }
    }
  });

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    // Bounded: a runaway CLI must not grow this without limit.
    stderr = (stderr + chunk).slice(-8192);
  });

  child.on('error', (cause: Error) => {
    push({ kind: 'error', message: describeSpawnFailure(adapter.binary, cause) });
    done = true;
    wake?.();
  });

  child.on('close', (code) => {
    if (stdoutRest.trim()) {
      try {
        for (const event of adapter.parseLine(stdoutRest)) push(event);
      } catch {
        /* ignore */
      }
    }
    // Order matters: a stop the member asked for is not a failure, and a failure the adapter already
    // explained precisely must not be restated vaguely from an exit code.
    if (cancelled) push({ kind: 'cancelled' });
    else if (code !== 0 && !reportedError) push(adapter.explainExit(code, stderr));
    done = true;
    wake?.();
  });

  const onAbort = () => {
    cancelled = true;
    child.kill();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (!done || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      yield queue.shift() as AgentEvent;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

/**
 * Turn a failure to start into a sentence that points at the real cause.
 *
 * `EINVAL` and `EFTYPE` on Windows are not "not installed" — they are Node refusing to execute a
 * `.cmd`/`.bat` or `.ps1` without a shell, which is the fix for CVE-2024-27980. A member who
 * installed the CLI with `npm i -g` gets exactly that, and telling them to check their PATH sends
 * them to look for something that is already there. Reproduced on Node 24: spawning a `.cmd` with
 * `shell: false` throws `EINVAL` synchronously.
 *
 * We do not work around it by turning the shell back on. The prompt is untrusted text, and a shell
 * would make it syntax — trading a startup failure for a command-injection surface is not a trade.
 * See `docs/providers-and-subscription-legality.md` §9.5 for the options being weighed instead.
 */
function describeSpawnFailure(binary: string, cause: Error & { code?: string }): string {
  if (cause.code === 'EINVAL' || cause.code === 'EFTYPE') {
    return (
      `«${binary}» установлен через npm, и Windows не запускает такую обёртку напрямую. ` +
      'Это не проблема PATH — файл на месте. Поставь нативную сборку инструмента ' +
      'или используй режим по ключу.'
    );
  }
  if (cause.code === 'ENOENT') {
    return `«${binary}» не найден. Установи его и убедись, что он доступен в PATH.`;
  }
  return `Не удалось запустить «${binary}»: ${cause.message}`;
}
