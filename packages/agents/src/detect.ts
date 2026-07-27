/**
 * Is a vendor CLI present on this machine — and deliberately nothing more than that.
 *
 * Detection is the first thing the shell asks the provider layer, and it is the easiest place to
 * quietly break the invariant the whole package exists for. The tempting version of this file walks
 * the vendor's config directory to find out whether the member is signed in. This one does not, and
 * cannot: there is no code path here that opens a credential file, an OS secret store, or a vendor
 * endpoint. "Installed" means one thing only — an executable with that name sits in an absolute
 * directory on PATH — and the optional version comes from running that executable with `--version`
 * and reading its stdout, in an environment built by `env.ts` rather than inherited.
 *
 * Three consequences worth stating, because each looks like an omission and is not:
 *
 * 1. `auth` is always `'unknown'`. See the field's own comment.
 * 2. Google is never probed. Its CLI transport is `prohibited` in `policy.ts`, so `detectCli`
 *    returns the refusal without touching the filesystem — we do not go looking for a binary we
 *    have already decided we may not start.
 * 3. Even a version probe gets the allowlisted environment. A `--version` run is harmless, but
 *    building the environment two different ways in two places is exactly how the second one ends
 *    up wrong; there is one builder and this file uses it.
 *
 * The PATH walk is ours rather than `which` / `where` because those answer with whatever the caller's
 * environment happens to say, and because the walk is stricter than the OS: it ignores relative PATH
 * entries and never looks in the current directory, both of which resolve against wherever the
 * daemon happens to have been started. Nothing here is passed to a shell to parse; when a `.cmd`
 * wrapper has to be started, `engine.ts` builds the interpreter's argument vector itself and this
 * file reuses that decision rather than making a second one.
 */

import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';

import { assertNoLeakedCredentials, buildAgentEnv } from './env.ts';
import { PROVIDERS, checkAllowed, findProvider } from './policy.ts';
import { executableKind, planSpawn } from './spawn.ts';

export interface CliDetection {
  providerId: string;
  binary: string;
  /** Найден ли бинарь в PATH. */
  installed: boolean;
  /** Абсолютный путь, если найден. */
  path?: string;
  /** Версия, если её удалось прочитать. */
  version?: string;
  /**
   * Залогинен ли человек. ВАЖНО: у нас НЕТ документированного способа это узнать, не потратив
   * токены и не прочитав credential. Поэтому всегда 'unknown' — и это честно, а не заглушка.
   *
   * The two ways to find out both violate something. Reading the vendor's stored credential breaks
   * the invariant this package is built on — PartyCo never sees a credential, which is the sentence
   * the product is sold on. Sending a trial prompt spends the member's quota to answer a question
   * they did not ask, and on a metered key it spends their money. Neither vendor documents a
   * free-of-charge "am I signed in" call, so there is nothing honest left to call.
   *
   * The information does arrive, just later and from the right place: the first real run fails with
   * an authentication error, and `AgentAdapter.explainExit` turns it into an `ErrorEvent` with
   * `authFailed: true` and a sentence telling the member to sign into their own CLI. That is one
   * fact learned from one authoritative source at the moment it matters, instead of a guess
   * refreshed on every screen paint.
   */
  auth: 'unknown';
  /**
   * Почему детект неполный, человеческим языком.
   *
   * Set when `installed` is false, and also in the one case where the binary was found but cannot be
   * started: a PowerShell script (`.ps1`), which needs an interpreter PartyCo does not use. A member
   * told only "installed" would then watch the run fail with "not found in PATH", which is both
   * wrong and unactionable. The npm `.cmd` / `.bat` wrappers used to be in this category and no
   * longer are — `engine.ts` starts them, because the prompt no longer travels in argv.
   */
  hint?: string;
}

/**
 * Does this absolute path exist and look runnable?
 *
 * Injected in tests so detection does not depend on what happens to be installed on the machine
 * running them. The default is the only implementation that touches the disk in this file, and it
 * only ever asks about the executable itself.
 */
export type AccessFn = (filePath: string) => Promise<boolean>;

export interface DetectOptions {
  /**
   * Source environment for both the PATH walk and the version probe. Defaults to this process's,
   * via `buildAgentEnv` — which is also what filters it. Note that the search therefore uses the
   * same PATH the child will get, so detection cannot find a binary the run would then miss.
   */
  env?: NodeJS.ProcessEnv | undefined;
  /** Injectable for tests. Defaults to `node:child_process.spawn`. */
  spawnFn?: typeof spawn | undefined;
  /** Injectable for tests. Defaults to a `stat`-based check. */
  accessFn?: AccessFn | undefined;
  /** Target platform, so the Windows PATHEXT rules can be exercised from any host. */
  platform?: NodeJS.Platform | undefined;
  /** How long a `--version` run may take before it is killed and the field left empty. */
  timeoutMs?: number | undefined;
}

/** A CLI that needs longer than this to print its own version is not going to answer a prompt. */
const VERSION_TIMEOUT_MS = 5_000;

/** A `--version` run prints one line. Anything past this is a malfunction, not information. */
const MAX_PROBE_OUTPUT = 8 * 1024;

/** What Windows falls back to when PATHEXT is unset. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * Extension preference, most useful first.
 *
 * `.exe` and `.com` lead because on Windows they are the only extensions a process can start
 * directly: Node refuses `.cmd` and `.bat` outright unless a shell is opted into (EINVAL, the fix
 * for CVE-2024-27980) and the OS refuses `.ps1` (EFTYPE). The npm wrappers rank next because
 * `engine.ts` can now start them through `cmd.exe` — fewer moving parts is still better, so a real
 * executable beside a wrapper still wins. Everything not listed sorts after these, and `.ps1` sorts
 * last: it is the one extension nothing here will run.
 */
const EXT_PREFERENCE: readonly string[] = ['.exe', '.com', '.cmd', '.bat'];

function extRank(ext: string): number {
  const index = EXT_PREFERENCE.indexOf(ext);
  if (index >= 0) return index;
  return ext === '.ps1' ? EXT_PREFERENCE.length + 1 : EXT_PREFERENCE.length;
}

function defaultAccessFn(platform: NodeJS.Platform): AccessFn {
  const isWindows = platform === 'win32';
  return async (filePath) => {
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return false;
      // Windows has no execute bit; presence plus a runnable extension is the whole test there.
      if (isWindows) return true;
      await access(filePath, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
}

/** PATH entries may be quoted on Windows; the quotes are syntax, not part of the directory name. */
function unquote(entry: string): string {
  const trimmed = entry.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Executable extensions to try, in the order we would rather have them, lower-cased. */
function pathExtensions(env: Record<string, string>, isWindows: boolean): string[] {
  if (!isWindows) return [];
  const raw = env['PATHEXT'];
  const listed = (raw && raw.trim().length > 0 ? raw : DEFAULT_PATHEXT)
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.startsWith('.') && ext.length > 1);
  const source = listed.length > 0 ? listed : DEFAULT_PATHEXT.toLowerCase().split(';');
  return [...new Set(source)].sort((a, b) => extRank(a) - extRank(b));
}

/** File names to look for in each directory: the bare name on POSIX, name + extension on Windows. */
function candidateNames(binary: string, extensions: readonly string[], isWindows: boolean): string[] {
  if (!isWindows) return [binary];
  const lower = binary.toLowerCase();
  // A caller who already said `claude.exe` gets exactly that and no guessing.
  if (extensions.some((ext) => lower.endsWith(ext))) return [binary];
  return extensions.map((ext) => binary + ext);
}

/**
 * Walk PATH ourselves.
 *
 * Order matters and mirrors the OS: directories in PATH order, and within a directory the
 * extensions in preference order — so a machine carrying both `claude.exe` and `claude.cmd` in one
 * folder yields the one we can start.
 */
async function findOnPath(
  binary: string,
  env: Record<string, string>,
  platform: NodeJS.Platform,
  exists: AccessFn,
): Promise<string | null> {
  const isWindows = platform === 'win32';
  const p = isWindows ? path.win32 : path.posix;

  const rawPath = env['PATH'];
  if (!rawPath) return null;

  const extensions = pathExtensions(env, isWindows);
  const names = candidateNames(binary, extensions, isWindows);

  for (const entry of rawPath.split(p.delimiter)) {
    const dir = unquote(entry);
    if (!dir) continue;
    // A relative entry — including the `.` that cmd.exe implicitly searches first — resolves against
    // whatever directory the daemon was started in. That turns "which binary runs" into a property
    // of the caller's working directory, which is the shape of a hijack. Absolute entries only.
    if (!p.isAbsolute(dir)) continue;

    for (const name of names) {
      const candidate = p.join(dir, name);
      if (await exists(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * The PATH walk on its own, for the one caller that needs a path rather than a description.
 *
 * `engine.ts` uses it when it was handed a bare binary name: on Windows an npm wrapper cannot be
 * found that way at all, and the file extension is what decides how the process must be started.
 * Exported from here rather than reimplemented there so that "which file will run" has exactly one
 * answer — a run that started a different file than the providers screen reported would be a bug
 * nobody could see.
 */
export async function resolveExecutable(
  binary: string,
  env: Record<string, string>,
  platform: NodeJS.Platform,
  accessFn?: AccessFn,
): Promise<string | null> {
  return await findOnPath(binary, env, platform, accessFn ?? defaultAccessFn(platform));
}

/** First line of output with colour codes and control characters removed, or null if there is none. */
function firstUsefulLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line
      .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) return cleaned.slice(0, 120);
  }
  return null;
}

/**
 * Ask the binary what version it is.
 *
 * Every failure mode returns null rather than throwing. A version is a nicety — the member wants to
 * know whether the thing is there, and an unreadable version must not turn a working installation
 * into a reported-missing one. Windows in particular fails *synchronously* out of `spawn` for files
 * it will not start directly, which is why the call is wrapped rather than only listened to.
 *
 * How to start it is decided by `planSpawn`, the same function the real run uses, so a wrapper that
 * detection could read a version from is by construction a wrapper the run can start. Deciding it
 * twice, in two files, is how the two answers drift apart. `--version` is the whole argument vector
 * and it is this package's own flag, so the interpreter check passes trivially — there is no
 * untrusted text in a version probe at all.
 */
const VERSION_ARGS: readonly string[] = ['--version'];

async function probeVersion(
  command: string,
  env: Record<string, string>,
  spawnFn: typeof spawn,
  timeoutMs: number,
  platform: NodeJS.Platform,
): Promise<string | null> {
  const planned = planSpawn({
    command,
    args: VERSION_ARGS,
    platform,
    promptInArgv: false,
    ownFlags: VERSION_ARGS,
    systemRoot: env['SystemRoot'],
  });
  if (!planned.ok) return null;

  let child: ReturnType<typeof spawn>;
  try {
    child = spawnFn(planned.plan.command, [...planned.plan.args], {
      env,
      // No shell here either. Detection has no untrusted input in its argv, but a second spawn site
      // with different rules is how the first rule stops being true.
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: planned.plan.windowsVerbatimArguments,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }

  return await new Promise<string | null>((resolve) => {
    let out = '';
    let err = '';
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);
    // A stuck probe must not keep the daemon's event loop alive on its own.
    timer.unref?.();

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      out = (out + chunk).slice(0, MAX_PROBE_OUTPUT);
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      err = (err + chunk).slice(0, MAX_PROBE_OUTPUT);
    });

    // ENOENT and friends arrive here rather than as a throw.
    child.on('error', () => finish(null));

    child.on('close', () => {
      // Some CLIs print their version on stderr, and some exit non-zero while doing it. If a version
      // came out, it came out; the exit code is not more authoritative than the text.
      finish(firstUsefulLine(out) ?? firstUsefulLine(err));
    });
  });
}

function notInstalled(providerId: string, binary: string, hint: string): CliDetection {
  return { providerId, binary, installed: false, auth: 'unknown', hint };
}

/**
 * Detect one provider's CLI.
 *
 * Never throws and never rejects: a detection failure is a fact to display, not an exception to
 * handle. Every unhappy path returns `installed: false` with a `hint` the member can act on.
 */
export async function detectCli(
  providerId: string,
  options: DetectOptions = {},
): Promise<CliDetection> {
  const {
    env,
    spawnFn = spawn,
    accessFn,
    platform = process.platform,
    timeoutMs = VERSION_TIMEOUT_MS,
  } = options;

  const provider = findProvider(providerId);
  if (!provider) {
    return notInstalled(providerId, '', `Провайдер «${providerId}» не поддерживается.`);
  }

  // Policy first, filesystem never if policy says no. Looking for a binary we are forbidden to start
  // would be a pointless disk read that also teaches the next reader the wrong order of operations.
  const verdict = checkAllowed(providerId, 'local-agent-cli');
  if (!verdict.allowed) {
    return notInstalled(providerId, provider.cliBinary ?? '', verdict.reason);
  }

  const binary = provider.cliBinary;
  if (!binary) {
    return notInstalled(
      providerId,
      '',
      `У «${provider.label}» нет CLI, который можно запустить — используй ключ.`,
    );
  }

  let childEnv: Record<string, string>;
  try {
    childEnv = buildAgentEnv({
      providerId,
      mode: 'subscription',
      ...(env ? { source: env } : {}),
    });
    assertNoLeakedCredentials(childEnv);
  } catch (cause) {
    return notInstalled(providerId, binary, cause instanceof Error ? cause.message : String(cause));
  }

  const exists = accessFn ?? defaultAccessFn(platform);
  const found = await findOnPath(binary, childEnv, platform, exists);

  if (!found) {
    return notInstalled(
      providerId,
      binary,
      `«${binary}» не найден в PATH. Установи ${provider.label} CLI и войди в него сам — ` +
        `PartyCo не показывает экран входа и не видит твой логин. ` +
        `Проверить можно так: выполни «${binary} --version» в своём терминале.`,
    );
  }

  if (executableKind(found, platform) === 'unsupported') {
    return {
      providerId,
      binary,
      installed: true,
      path: found,
      auth: 'unknown',
      hint:
        `«${binary}» найден (${found}), но это сценарий PowerShell — его запуск требует отдельного ` +
        `интерпретатора, которым PartyCo не пользуется. Поставь ${provider.label} CLI нативной ` +
        `сборкой или через npm: в обоих случаях в PATH окажется файл, который PartyCo запустит.`,
    };
  }

  const version = await probeVersion(found, childEnv, spawnFn, timeoutMs, platform);

  return {
    providerId,
    binary,
    installed: true,
    path: found,
    ...(version ? { version } : {}),
    auth: 'unknown',
  };
}

/**
 * Detect every CLI we are allowed to start.
 *
 * Providers whose CLI transport is not selectable are skipped outright rather than returned as
 * "not installed" — the answer for Google is not "we could not find it", it is "we will not look",
 * and a row saying the former would invite someone to go install it. `checkAllowed` carries the
 * reason for anyone who asks directly via `detectCli`.
 */
export async function detectAll(options: DetectOptions = {}): Promise<CliDetection[]> {
  const detectable = PROVIDERS.filter(
    (provider) =>
      provider.cliBinary !== undefined && checkAllowed(provider.id, 'local-agent-cli').allowed,
  );
  return await Promise.all(detectable.map((provider) => detectCli(provider.id, options)));
}
