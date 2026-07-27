/**
 * The shared vocabulary every provider adapter implements, and the one place a child process is
 * actually started for a run.
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
 *
 * The prompt does not travel in argv. Both vendors document reading it from standard input, so it is
 * written to the child's stdin and the stream is closed — see `PromptDelivery`. That is the premise
 * `spawn.ts` depends on to start an npm `.cmd` wrapper on Windows at all: with no untrusted text on
 * the command line, the only things a command interpreter ever sees are flags this package wrote.
 */

import { spawn } from 'node:child_process';
import { resolveExecutable, type AccessFn } from './detect.ts';
import { assertNoLeakedCredentials, buildAgentEnv, type AuthMode } from './env.ts';
import { checkAllowed, findProvider } from './policy.ts';
import { planSpawn, systemProgram } from './spawn.ts';

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
 * Which channel carries the member's question to the CLI.
 *
 * `stdin` is the only value in use, and it is stated per adapter rather than assumed because it is a
 * fact about a vendor's CLI, not a preference of ours. Both vendors document it:
 *
 *  - Claude Code — the headless page says "Non-interactive mode reads stdin, so you can pipe data in
 *    and redirect the response out like any other command-line tool", and its own
 *    `--append-system-prompt` example runs `gh pr diff "$1" | claude -p --append-system-prompt …`
 *    with no prompt argument at all.
 *  - Codex — "If you omit the prompt argument, Codex reads the prompt from stdin. Use `codex exec -`
 *    when you want to force that behavior explicitly."
 *
 * Two things follow, and both are why this is a field instead of a comment. A prompt outside argv
 * cannot be read as a flag, cannot be seen in a process listing, and is not bound by the Windows
 * 32767-character command line — a long question used to simply fail to send. And an adapter that
 * has to put the prompt in argv is refused the Windows interpreter path in `planSpawn`: half a
 * safety property is worse than an honest refusal, so that adapter would keep failing on `.cmd`
 * until its vendor documents a way to stop putting untrusted text on a command line.
 */
export type PromptDelivery = 'stdin' | 'argv';

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
  /*
   * There is deliberately no `versionArgs` / `parseVersion` here.
   *
   * Both used to be declared, both were implemented by both adapters, and neither was ever called:
   * `detect.ts` walks `PROVIDERS.cliBinary` and does its own probing with its own `--version` and
   * its own `firstUsefulLine`. A second, unreachable answer to «как прочитать версию» is precisely
   * the drift that file's own comment warns about — so the contract now declares only what somebody
   * reads. If a CLI ever needs a different version flag, the fix is to give `detect.ts` the adapter,
   * not to re-add a field nothing consults.
   */
  /** Where the prompt goes. See `PromptDelivery`. */
  promptDelivery: PromptDelivery;
  /**
   * Every argv token beginning with `-` this adapter is allowed to emit, `--` and `-` included.
   *
   * The list exists so `planSpawn` can check it. A `.cmd` wrapper is only started through a command
   * interpreter when the flags reaching it are exactly the ones written in this package — anything
   * else means an argument arrived from somewhere the adapter does not control, and the run is
   * refused rather than escaped.
   */
  ownFlags: readonly string[];
  /** Arguments for one non-interactive run. Must not include any credential, and no prompt. */
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
   * Worth passing: a bare name finds nothing on Windows when only an npm `.cmd` shim is installed,
   * and the resulting `ENOENT` reads as "not installed" for something that is. It is also what lets
   * `planSpawn` see the file extension and choose how to start it. Falls back to the adapter's bare
   * binary name, which is what PATH resolution does everywhere else.
   */
  binaryPath?: string;
  /** Injectable for tests. Defaults to `node:child_process.spawn`. */
  spawnFn?: typeof spawn;
  /** Injectable for tests. Used only when `binaryPath` is absent; defaults to a `stat`-based check. */
  accessFn?: AccessFn;
  env?: NodeJS.ProcessEnv;
  /** Target platform, so the Windows rules can be exercised from any host. */
  platform?: NodeJS.Platform;
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/**
 * Run one agent turn and stream its events.
 *
 * The ordering here is the contract: policy is checked before an environment is built, the
 * environment is asserted clean before a process exists, and the process is started with
 * `shell: false` so no string is ever handed to a shell to interpret. The prompt is untrusted text —
 * it comes from a person and may quote anything — and it is written to the child's stdin, where it
 * is data by construction rather than data that has to be kept from looking like syntax.
 */
export async function* runAgent(options: RunOptions): AsyncGenerator<AgentEvent> {
  const {
    adapter,
    request,
    mode,
    apiKey,
    signal,
    binaryPath,
    spawnFn = spawn,
    accessFn,
    env: source,
    platform = process.platform,
  } = options;

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

  // Windows cannot find an npm wrapper from a bare name — measured, not assumed: spawning the bare
  // name of a CLI installed only as `x.cmd` answers ENOENT, because libuv's PATH search does not
  // reach it and `CreateProcessW` would only ever append `.exe`. And the extension is what
  // `planSpawn` needs in order to know a wrapper is a wrapper. So when the caller did not resolve a
  // path, resolve it here rather than fail for a program that is installed. The walk is the same one
  // detection uses, so a run cannot start a different file than the screen reported.
  //
  // Only on Windows. Elsewhere a bare name is what `execvp` resolves, exactly as it always has, and
  // widening the change to platforms that never had the problem would be a second thing to debug.
  const command =
    binaryPath ??
    (platform === 'win32'
      ? ((await resolveExecutable(adapter.binary, childEnv, platform, accessFn)) ?? adapter.binary)
      : adapter.binary);

  // Resolving a path is the first thing in this function that takes real time, so it is the first
  // place a stop can arrive with nothing yet started. Without this check the listener below would be
  // attached to an already-aborted signal, which never fires again — the child would run to
  // completion with nobody able to stop it, and the member's stop button would have done nothing.
  if (signal?.aborted) {
    yield { kind: 'cancelled' };
    return;
  }

  const planned = planSpawn({
    command,
    args: adapter.buildArgs(request),
    platform,
    promptInArgv: adapter.promptDelivery === 'argv',
    ownFlags: adapter.ownFlags,
    systemRoot: childEnv['SystemRoot'],
  });
  if (!planned.ok) {
    yield { kind: 'error', message: planned.reason };
    return;
  }
  const plan = planned.plan;

  let child: ReturnType<typeof spawn>;
  try {
    child = spawnFn(plan.command, [...plan.args], {
      cwd: request.cwd,
      env: childEnv,
      // No shell. Nothing here is a command string to be parsed: either the executable is started
      // directly, or one named interpreter is given an argument vector `planSpawn` assembled.
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
      stdio: [adapter.promptDelivery === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    // Windows throws EINVAL synchronously for a file it will not start rather than emitting 'error',
    // so a listener alone would never see it and the run would hang instead of failing.
    yield { kind: 'error', message: describeSpawnFailure(adapter.binary, cause as Error) };
    return;
  }

  if (adapter.promptDelivery === 'stdin') {
    const stdin = child.stdin;
    if (stdin) {
      // The child can be gone before it reads a byte — a bad flag, a missing login, a wrapper that
      // failed to resolve — and writing to a closed pipe raises EPIPE on the stream. Unhandled, that
      // is an uncaught exception in the daemon for a failure `explainExit` already reports properly.
      stdin.on('error', () => {
        /* the CLI exited before it read the prompt; its own exit explains why */
      });
      // Written verbatim and closed immediately: one turn, exactly the bytes the member typed, and
      // an EOF so the CLI knows the question is complete.
      stdin.end(request.prompt);
    }
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

  /**
   * End the run's process, and everything it started when an interpreter is in the way.
   *
   * Killing `cmd.exe` on Windows terminates the interpreter and leaves the CLI it launched running:
   * TerminateProcess does not walk the tree. That would turn "the member pressed stop" into an
   * orphaned agent still editing their worktree, which is worse than not offering stop at all. So on
   * that one path the tree is killed by pid with `taskkill /t`, a Windows program with a fixed
   * argument vector and no shell involved. The direct path is untouched: there is no middleman to
   * outlive.
   */
  const killTree = (): void => {
    const pid = child.pid;
    if (plan.viaInterpreter && pid !== undefined) {
      try {
        const killer = spawnFn(
          systemProgram(childEnv['SystemRoot'], 'taskkill.exe'),
          ['/pid', String(pid), '/t', '/f'],
          {
            // Not `childEnv`. In `api-key` mode that carries the member's key, and a program whose
            // whole job is to end a process has no business being handed one. `SystemRoot` is what a
            // Windows process needs to start at all; the executable is already an absolute path, so
            // there is nothing to look up.
            env: { SystemRoot: childEnv['SystemRoot'] ?? 'C:\\Windows' },
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          },
        );
        killer.on('error', () => {
          /* taskkill missing or already done — the direct kill below still runs */
        });
      } catch {
        /* fall through to the direct kill */
      }
    }
    child.kill();
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
    killTree();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  // An abort that landed between the spawn and this line would otherwise be lost: `addEventListener`
  // on a signal that has already fired never calls back.
  if (signal?.aborted) onAbort();

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
    if (child.exitCode === null && child.signalCode === null) killTree();
  }
}

/**
 * Turn a failure to start into a sentence that points at the real cause.
 *
 * `EINVAL` and `EFTYPE` on Windows are not "not installed" — they are Node refusing to execute a
 * `.cmd`/`.bat` or `.ps1` directly, which is the fix for CVE-2024-27980. Reaching this branch is now
 * unusual: `planSpawn` recognises those wrappers by extension and either routes a `.cmd` through the
 * interpreter or refuses with a specific reason. What is left is the case where the extension was
 * never known, i.e. the executable was passed as a bare name instead of the path detection resolved.
 * Telling the member to check their PATH would send them looking for something already there.
 */
function describeSpawnFailure(binary: string, cause: Error & { code?: string }): string {
  if (cause.code === 'EINVAL' || cause.code === 'EFTYPE') {
    return (
      `Windows отказался запускать «${binary}» напрямую — обычно так выглядит обёртка, ` +
      'которую ставит npm. Это не проблема PATH: файл на месте. PartyCo умеет запускать такие ' +
      'обёртки, но для этого ему нужен полный путь до файла — вернись на экран провайдеров, ' +
      'чтобы он нашёлся заново.'
    );
  }
  if (cause.code === 'ENOENT') {
    return `«${binary}» не найден. Установи его и убедись, что он доступен в PATH.`;
  }
  return `Не удалось запустить «${binary}»: ${cause.message}`;
}
