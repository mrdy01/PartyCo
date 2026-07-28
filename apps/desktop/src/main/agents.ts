import { ipcMain, safeStorage, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import {
  AGENT_PERMISSIONS,
  CAPABILITIES,
  POLICY_NEEDS_CONSENT,
  POLICY_SELECTABLE,
  PROVIDERS,
  checkAllowed,
  detectAll,
  findAdapter,
  findProvider,
  runAgent,
  type AgentEvent,
  type AgentPermission,
  type AuthMode,
  type CliDetection,
  type PolicyStatus,
  type ProviderCapability,
  type ProviderPolicy,
} from '@partyco/agents';
import {
  readAgentSettings,
  writeAgentSettings,
  type AgentSettings,
} from './agent-settings.ts';
import { platformPaths } from './platform.ts';
import { currentWorkspaceRoot } from './workspace.ts';

export type { AgentSettings } from './agent-settings.ts';

/**
 * The main-process side of the provider layer.
 *
 * Everything `@partyco/agents` can do reaches the renderer through exactly the handlers below, and
 * the shape of that surface is a security decision rather than an ergonomic one. Two rules drive it:
 *
 * **A key goes in and never comes out.** `agents:setKey` accepts one; nothing returns one. The only
 * thing the renderer may learn is `hasKey: boolean`. The renderer is web content — it renders
 * repository text and model output, both attacker-influenceable — so a key that reaches it is a key
 * that has left the machine's trusted half. The product promise is «ключи не покидают эту машину»,
 * and this file is where that promise is either kept or quietly broken. The key now survives a
 * restart — encrypted by the OS, on this side of the bridge — and that changed the lifetime of the
 * secret and nothing else: `hasKey` is still the whole of what the renderer can learn, and
 * `persisted` says which of the two possible fates the key had.
 *
 * **The renderer is not trusted to pick a provider, a mode or a directory.** Every one of those is
 * re-checked here against `policy.ts` and the filesystem before a process exists. `checkAllowed` is
 * consulted even though `runAgent` consults it again: failing at the IPC boundary produces a
 * sentence a person can read, failing inside the stream produces an error event nobody asked for.
 *
 * The catalogue itself lives in `packages/agents/src/policy.ts` and the child environment in
 * `env.ts`. Neither is duplicated here — this file routes, validates and streams, and owns no policy
 * of its own.
 */

/* ------------------------------------------------------------------ *
 * The contract, owned here
 * ------------------------------------------------------------------ */

/**
 * Every handler answers with this instead of throwing.
 *
 * A `throw` inside `ipcMain.handle` crosses the bridge as a rejected promise carrying the main
 * process's stack trace, i.e. absolute paths and internal function names handed to the least trusted
 * part of the app. An error that a person can read is more useful anyway.
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** The provider catalogue as the UI needs it: entries plus the two selectability tables. */
export interface AgentPolicyCatalog {
  providers: readonly ProviderPolicy[];
  selectable: Readonly<Record<PolicyStatus, boolean>>;
  needsConsent: Readonly<Record<PolicyStatus, boolean>>;
  /**
   * What each provider may actually be asked for — models and permission modes.
   *
   * Carried over IPC rather than imported by the renderer, even though it is static data with no
   * Node in it. `@partyco/agents` reaches `node:child_process` through its own barrel, and a renderer
   * import of that barrel is how Node ends up inside web content.
   */
  capabilities: readonly ProviderCapability[];
}

/** One turn, as the renderer asks for it. Nothing here is trusted until `parseRunRequest` says so. */
export interface AgentRunRequest {
  /** Chosen by the preload, not the main process, so the renderer can subscribe before events flow. */
  runId: string;
  providerId: string;
  mode: AuthMode;
  prompt: string;
  /**
   * Where the agent will work.
   *
   * Absolute, and inside the workspace the member chose — see {@link resolveRunCwd}. What the
   * renderer sends is a claim; what a run receives is the symlink-resolved path that survived it.
   */
  cwd: string;
  model?: string | undefined;
  /**
   * How much the agent may do without asking. Absent means the CLI's own default.
   *
   * Validated against a closed list below rather than passed through, because this is the one field
   * whose value — not its flag — decides authority, and `planSpawn` only ever inspects flags.
   */
  agentMode?: AgentPermission | undefined;
}

/** What the renderer sends. The `runId` is the preload's business. */
export type AgentRunInput = Omit<AgentRunRequest, 'runId'>;

export interface AgentRunOutcome {
  runId: string;
  /** True when the turn ended because `agents:cancel` fired rather than because the CLI finished. */
  cancelled: boolean;
}

export interface AgentCancelOutcome {
  /** False when the id was unknown — a finished run is not an error to cancel. */
  cancelled: boolean;
}

/** Per-provider key presence. Deliberately a boolean and nothing else. */
export interface AgentKeyState {
  providerId: string;
  hasKey: boolean;
}

export interface AgentKeyReport {
  keys: readonly AgentKeyState[];
  /**
   * Whether a key given now is still here after a restart.
   *
   * `true` means the store on this machine is encrypted by the OS — DPAPI on Windows, the Keychain
   * on macOS — and the last write to it went through. `false` means the key lives in this process's
   * memory and nowhere else, and the member types it again next launch. Two things produce it:
   * `safeStorage.isEncryptionAvailable()` answering no (a Linux box without a keyring is the
   * ordinary case), or the write itself failing. There is deliberately no third answer where the key
   * is written in plaintext because encryption was unavailable — see {@link writeKeyStore}.
   *
   * It used to be typed as the literal `false` so the UI could not forget to say so. It is a real
   * boolean now, and the obligation moved rather than disappeared: the panel says which of the two
   * happened, because «ключ сохранён» and «ключ придётся ввести заново» are different promises.
   */
  persisted: boolean;
}

/**
 * What travels on a run's private channel.
 *
 * `end` exists so the preload knows when to drop its listener. Without it every started run leaks
 * one `ipcRenderer` listener for the lifetime of the window.
 */
export type AgentStreamMessage =
  | { runId: string; type: 'event'; event: AgentEvent }
  | { runId: string; type: 'end' };

/** Channel a single run streams on. The preload subscribes to it before asking for the run. */
export function agentEventChannel(runId: string): string {
  return `agents:event:${runId}`;
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/**
 * Member-supplied API keys, by provider id. **This process only.**
 *
 * The map is the working copy; the file written by {@link writeKeyStore} is its encrypted shadow, and
 * `safeStorage` — DPAPI on Windows, the Keychain on macOS — is what makes the shadow safe to leave
 * lying about. Persistence moves nothing across the bridge: there is still no getter, no
 * `localStorage` mirror and no channel that returns a key, because a key in the renderer is a key in
 * web content. The only thing that changed is that the ciphertext outlives the process.
 *
 * Note what cannot be done about the value once it is here: a JavaScript string cannot be zeroed.
 * The mitigation is scope — the key exists in one map, is read at spawn time, and dies with the
 * process.
 */
const apiKeys = new Map<string, string>();

/** In-flight runs, so `agents:cancel` has something to abort. */
const runs = new Map<string, AbortController>();

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/** UUID v4, the only shape a run id may take — it becomes an IPC channel name. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Vendor model ids are slugs: `claude-sonnet-4-6`, `gpt-5.2-codex`, `models/gemini-3-pro`. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

const AUTH_MODES: readonly AuthMode[] = ['subscription', 'api-key'];

/**
 * Prompt ceiling.
 *
 * The reason it used to have is gone and saying so matters: the prompt travelled in argv, and
 * `CreateProcess` caps a whole command line at 32767 characters, so a long question failed to send.
 * `packages/agents` now writes the prompt to the child's stdin (`AgentAdapter.promptDelivery`), and
 * a pipe has no such limit — the old sentence would send a member shortening a question for a
 * constraint that no longer applies to it.
 *
 * The ceiling stays because untrusted input needs one at the boundary that accepts it: this string
 * is held in memory, copied into a transcript on disk and streamed to a vendor. 24 000 characters is
 * far past any question a person types and far short of anything that costs the daemon its memory.
 * A stated limit is a better bug report than a mysterious failure further in.
 */
const MAX_PROMPT_CHARS = 24_000;

/** Long enough for any vendor key; short enough that a pasted file is caught as the mistake it is. */
const MAX_KEY_CHARS = 512;

/**
 * Control characters cannot appear in an environment variable value without corrupting it, and a
 * trailing newline is exactly what a careless copy out of a terminal produces.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function succeed<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Turn whatever the renderer sent into a request, or into the reason it is not one.
 *
 * `cwd` is checked for shape here and for containment in {@link resolveRunCwd} — the filesystem
 * calls are async and every other check is not, so the cheap refusals happen first.
 */
function parseRunRequest(raw: unknown): IpcResult<AgentRunRequest> {
  if (!isRecord(raw)) return fail('Некорректный запрос: ожидался объект.');

  const { runId, providerId, mode, prompt, cwd, model, agentMode } = raw;

  if (typeof runId !== 'string' || !RUN_ID.test(runId)) {
    return fail('Некорректный идентификатор рана.');
  }
  if (typeof providerId !== 'string') return fail('Не указан провайдер.');
  const provider = findProvider(providerId);
  if (!provider) return fail(`Провайдер «${providerId}» не поддерживается.`);

  if (typeof mode !== 'string' || !AUTH_MODES.includes(mode as AuthMode)) {
    return fail('Режим авторизации должен быть «subscription» или «api-key».');
  }

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return fail('Пустой запрос — нечего отправлять агенту.');
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return fail(
      `Запрос длиннее ${MAX_PROMPT_CHARS} символов — столько PartyCo за один ход не принимает. ` +
        'Сократи его или положи текст в файл внутри рабочей папки и сошлись на него: агент ' +
        'прочитает файл сам, и это дешевле, чем пересылать его целиком в каждом ходе.',
    );
  }

  if (typeof cwd !== 'string' || cwd.length === 0) return fail('Не указана рабочая директория.');

  if (model !== undefined && (typeof model !== 'string' || !MODEL_ID.test(model))) {
    return fail('Некорректный идентификатор модели.');
  }

  /*
   * The permission mode is checked against the list, not against a shape.
   *
   * `MODEL_ID` above is a pattern, because a model id is an open set nobody here can enumerate. A
   * permission is the opposite: three values exist, and a fourth arriving over IPC means either a
   * bug or a renderer that is no longer ours. The vendor CLI would happily accept
   * `bypassPermissions`, and nothing else between here and argv would object — `planSpawn` reads
   * flags, and this value carries no dash. So this is the boundary that has to say no.
   */
  if (
    agentMode !== undefined &&
    (typeof agentMode !== 'string' || !AGENT_PERMISSIONS.includes(agentMode as AgentPermission))
  ) {
    return fail('Неизвестный режим агента.');
  }

  return succeed({
    runId,
    providerId: provider.id,
    mode: mode as AuthMode,
    prompt,
    cwd,
    ...(typeof model === 'string' ? { model } : {}),
    ...(typeof agentMode === 'string' ? { agentMode: agentMode as AgentPermission } : {}),
  });
}

/**
 * Windows and macOS compare paths case-insensitively; Linux does not. Same rule and same reason as
 * `main/workspace.ts`: the comparison has to match the filesystem's own, and has to err towards
 * refusing.
 */
function foldCase(value: string): string {
  return process.platform === 'linux' ? value : value.toLowerCase();
}

/** True when `target` is `root` itself or something beneath it. The separator is not decoration. */
function isInside(root: string, target: string): boolean {
  const r = foldCase(root);
  const t = foldCase(target);
  if (t === r) return true;
  return t.startsWith(r.endsWith(sep) ? r : r + sep);
}

/**
 * The directory the agent will be able to read and write, resolved and **bounded by the workspace
 * the member actually chose**.
 *
 * This is the widest privilege in the whole app: `codex exec --sandbox workspace-write --cd <dir>`
 * and `claude -p` started in `<dir>` may edit anything under it without asking again. Until now the
 * only checks were «absolute» and «exists», which means the directory came from the renderer and
 * nothing else — and the renderer is web content that displays repository text and model output.
 * One crafted string reaching `bridge.run` and the agent's write root is `C:\Users\<member>`, with
 * the app showing the same «работаю» it always shows. Nothing in the run would look wrong.
 *
 * So the answer comes from the main process instead: {@link currentWorkspaceRoot} is the folder the
 * member picked in a native dialog, remembered on disk here rather than in the window. The renderer
 * still sends `cwd` — it is in the contract and the real caller sends exactly this root — but it is
 * now a claim to be checked, not an instruction. A subdirectory is allowed because it is strictly
 * narrower than the root; anything else is refused.
 *
 * `realpath` on both sides is the part that matters. A textual prefix check passes for a symlink
 * inside the workspace that points at `C:\`, and the agent would then be writing through it with the
 * app convinced it stayed home. The resolved path is what gets spawned, so what was checked is what
 * runs.
 *
 * Every failure is its own sentence, because «не работает» is what a member reports when an app
 * collapses four different problems into one.
 */
async function resolveRunCwd(cwd: string): Promise<IpcResult<string>> {
  if (!isAbsolute(cwd)) {
    return fail(`Рабочая директория должна быть абсолютным путём, а получено «${cwd}».`);
  }

  const chosen = await currentWorkspaceRoot();
  if (chosen === null) {
    return fail('Рабочая папка не выбрана — выбери её, и агент будет работать в ней.');
  }

  let root: string;
  try {
    root = await realpath(chosen);
  } catch {
    return fail(`Рабочая папка «${chosen}» больше недоступна — выбери её заново.`);
  }

  let target: string;
  try {
    target = await realpath(cwd);
  } catch {
    return fail(`Директория «${cwd}» не существует или недоступна.`);
  }

  let isDirectory: boolean;
  try {
    isDirectory = (await stat(target)).isDirectory();
  } catch {
    return fail(`Директория «${cwd}» не существует или недоступна.`);
  }
  if (!isDirectory) return fail(`«${cwd}» — это не директория.`);

  if (!isInside(root, target)) {
    return fail(
      `PartyCo запускает агента только внутри выбранной рабочей папки, а «${cwd}» лежит вне её. ` +
        'Если работать нужно там — выбери эту папку рабочей.',
    );
  }

  return succeed(target);
}

/* ------------------------------------------------------------------ *
 * The key store on disk
 * ------------------------------------------------------------------ */

/**
 * Where the ciphertext lives, inside `platformPaths().config`.
 *
 * A `.json` extension for a file whose only real content is a base64 blob is deliberate: the
 * envelope carries a version, and a member who opens the file should see at a glance that there is
 * nothing readable in it rather than wonder what binary landed in their config folder.
 */
const KEY_FILE = 'provider-keys.json';

/** Bumped when the envelope changes; an older or newer file reads as «ключей нет», like the rest. */
const KEY_STORE_VERSION = 1;

interface KeyStoreEnvelope {
  version: number;
  /** `safeStorage.encryptString` output, base64. Opaque, machine-bound, account-bound. */
  cipher: string;
}

/**
 * Whether this machine can encrypt at all.
 *
 * `false` is a normal answer, not a broken install: on Linux `safeStorage` needs a keyring
 * (`libsecret` behind GNOME Keyring or KWallet) and a headless or minimal session has none. The
 * whole point of asking is that the answer decides between «store it encrypted» and «do not store
 * it», with plaintext-on-disk not among the options — a key written in the clear because encryption
 * was unavailable is the worst outcome available, since it looks like the safe one.
 *
 * Wrapped in a `try` because Electron requires the app to be ready before answering on Linux, and a
 * throw here would turn «нельзя шифровать» into a crash in a keystroke handler.
 */
function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function keyStoreFile(): string {
  return join(platformPaths().config, KEY_FILE);
}

/**
 * Everything a stored key must satisfy — the same rules `agents:setKey` states in words.
 *
 * Applied to what comes *out* of the file as well as to what goes in. Decryption succeeding proves
 * the bytes were sealed by this account on this machine; it does not prove they were sealed by a
 * version of this code that checked them.
 */
function isPlausibleKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_KEY_CHARS &&
    !CONTROL_CHARS.test(value)
  );
}

/**
 * Read the store, or answer with an empty one.
 *
 * **Every failure is «ключей нет».** A missing file (first run), a truncated file (a power cut mid
 * save), a file from another Windows account, a file from a restored backup of another machine, a
 * file from a future version — all of them mean the member types the key again, and none of them
 * means the app refuses to start or shows a dialog about cryptography. Nothing is deleted either:
 * a `safeStorage` that is temporarily unable to decrypt is a thing that happens, and destroying the
 * only copy of a key over it would be a worse answer than asking for it once.
 *
 * Nothing from the decrypted side of this function is ever logged or put in a message.
 */
async function readKeyStore(): Promise<ReadonlyMap<string, string>> {
  const keys = new Map<string, string>();
  if (!canEncrypt()) return keys;

  let raw: string;
  try {
    raw = await readFile(keyStoreFile(), 'utf8');
  } catch {
    return keys; // first run, or the member removed the file by hand
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return keys;
  }
  if (!isRecord(envelope)) return keys;
  if (envelope['version'] !== KEY_STORE_VERSION) return keys;
  const cipher = envelope['cipher'];
  if (typeof cipher !== 'string' || cipher.length === 0) return keys;

  let plain: string;
  try {
    plain = safeStorage.decryptString(Buffer.from(cipher, 'base64'));
  } catch {
    return keys; // sealed for somebody else — not ours to read, and not ours to erase either
  }

  let payload: unknown;
  try {
    payload = JSON.parse(plain);
  } catch {
    return keys;
  }
  if (!isRecord(payload)) return keys;

  // Driven by the catalogue rather than by the file: a provider id we no longer know stays out of
  // the map instead of travelling to a report and to `buildAgentEnv`, which would refuse it anyway.
  for (const provider of PROVIDERS) {
    const value = payload[provider.id];
    if (isPlausibleKey(value)) keys.set(provider.id, value);
  }
  return keys;
}

/** Distinguishes temporary files inside one process; the pid separates processes. */
let tempCounter = 0;

/**
 * Write the store, atomically, or remove it when there is nothing left to keep. Answers whether the
 * disk now matches {@link apiKeys} — `false` means «не смогли», never «не понадобилось».
 *
 * The temporary-file-plus-`rename` dance is the one from `main/workspace.ts`: writing in place
 * leaves a truncated file if the process dies mid-write, and a truncated key store is a key store
 * that reads as «ключей нет» on the next launch. `sync` before the rename is what makes that hold
 * after a power cut rather than only after a crash.
 *
 * **File permissions, stated exactly.** The temporary file is created with `0600` and `chmod`ed to
 * `0600` on POSIX, so it is owner-only from the moment it exists and the mode travels with the inode
 * through the rename. On Windows the mode argument is ignored by Node and nothing here touches ACLs:
 * the file inherits the ACL of `%APPDATA%\PartyCo`, which is the roaming profile's — the member's
 * account, SYSTEM and the local Administrators group. An administrator on that machine can read the
 * file; they cannot read the *key*, because DPAPI seals it to the member's login, and that — not the
 * ACL — is what this store leans on. A dedicated ACL was not written, and pretending otherwise in a
 * comment would be worse than not writing one.
 */
async function writeKeyStore(): Promise<boolean> {
  const dir = platformPaths().config;
  const target = join(dir, KEY_FILE);

  // «Забыть ключ» has to reach the disk too, and it has to work even when we cannot encrypt right
  // now: the file may well have been written on a day the keyring was up.
  if (apiKeys.size === 0) {
    await rm(target, { force: true });
    return true;
  }
  if (!canEncrypt()) return false;

  const payload: Record<string, string> = {};
  for (const [providerId, key] of apiKeys) payload[providerId] = key;
  const envelope: KeyStoreEnvelope = {
    version: KEY_STORE_VERSION,
    cipher: safeStorage.encryptString(JSON.stringify(payload)).toString('base64'),
  };

  await mkdir(dir, { recursive: true });
  const temp = join(dir, `${KEY_FILE}.${process.pid}.${(tempCounter += 1).toString(36)}.tmp`);

  const handle = await open(temp, 'w', 0o600);
  try {
    // The mode above applies only when `open` creates the file; `chmod` covers the leftover of a
    // process that died between `open` and `rename`, and is a no-op on Windows.
    if (process.platform !== 'win32') await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(envelope)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await renameWithRetry(temp, target);
  } catch (cause) {
    await rm(temp, { force: true });
    throw cause;
  }
  return true;
}

/**
 * Windows fact, not superstition: an antivirus or a search indexer can hold the destination open for
 * a few milliseconds after we close it, and the rename fails with EPERM/EBUSY. Two retries turn a
 * random save failure into a save. Copied from `main/workspace.ts` rather than shared, because the
 * two files own their own storage and a common helper would be a module that exists to be imported
 * twice.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (cause) {
      if (attempt >= 2) throw cause;
      await new Promise((done) => setTimeout(done, 25));
    }
  }
}

/**
 * `true` once the file has been folded into {@link apiKeys} — or once we decided there is nothing to
 * fold. The in-flight read is shared so two handlers at startup do not decrypt twice.
 */
let keysLoaded = false;
let keysLoading: Promise<ReadonlyMap<string, string>> | null = null;

/**
 * Make sure the map reflects the disk before anybody reads or changes it.
 *
 * Every handler that touches `apiKeys` awaits this *first*, which is what keeps the race in
 * `workspace.ts` from existing here at all: no mutation can land while the read is in flight, so a
 * key the member just cleared cannot be resurrected by a read that started before they cleared it.
 * The `has` guard below is the belt to that braces, and is what makes the merge safe to run twice.
 */
async function ensureKeysLoaded(): Promise<void> {
  if (keysLoaded) return;
  const pending = keysLoading ?? (keysLoading = readKeyStore());
  const fromDisk = await pending;
  keysLoading = null;
  // A key given in this process is newer than anything on disk, so it wins — and the guard makes
  // the merge idempotent for the concurrent callers that shared the read above.
  for (const [providerId, key] of fromDisk) {
    if (!apiKeys.has(providerId)) apiKeys.set(providerId, key);
  }
  // If the machine could not decrypt when that read ran, the answer was «прочитать не смогли», not
  // «на диске пусто». A keyring unlocked later in the session deserves another look, and asking
  // again costs one call — {@link readKeyStore} returns before touching the disk in that case.
  keysLoaded = canEncrypt();
}

/**
 * Saves are serialised.
 *
 * Two keys submitted in quick succession both rewrite the whole store, and unordered writes would
 * let the earlier snapshot land last — the second key silently absent from disk while the panel says
 * it was saved.
 */
let saving: Promise<boolean> = Promise.resolve(true);

function saveKeys(): Promise<boolean> {
  const next = saving.catch(() => false).then(() => writeKeyStore());
  saving = next.catch(() => false);
  return next;
}

/**
 * Whether the disk currently reflects {@link apiKeys}.
 *
 * Starts `true` because an empty map and an absent file agree, and is set from the outcome of every
 * real attempt afterwards. It is a separate question from «умеет ли машина шифровать», and both are
 * needed: a keyring that comes back up an hour after a key was accepted makes `canEncrypt()` true
 * again while that key is still nowhere on disk, and reporting `persisted: true` there would be the
 * exact lie this field exists to prevent.
 */
let storeIsCurrent = true;

/**
 * Persist the current map, and record whether it worked.
 *
 * A failure is not returned to the renderer as an error: the key is in memory and this session works
 * exactly as before, so `ok: false` would tell the panel that nothing happened when in fact
 * everything but the remembering happened. What the member is owed is the honest `persisted: false`
 * that comes back in the same report — «работает сейчас, но введи заново после перезапуска».
 *
 * The failure itself is swallowed rather than described: nothing about it needs the value, and an
 * error string that travels to the UI is the one place a key must never end up by accident.
 */
async function persistKeys(): Promise<void> {
  try {
    storeIsCurrent = await saveKeys();
  } catch {
    storeIsCurrent = false;
  }
}

function keyReport(): AgentKeyReport {
  return {
    keys: PROVIDERS.map((provider) => ({
      providerId: provider.id,
      hasKey: apiKeys.has(provider.id),
    })),
    persisted: canEncrypt() && storeIsCurrent,
  };
}

/* ------------------------------------------------------------------ *
 * Streaming one run
 * ------------------------------------------------------------------ */

/**
 * Drive one turn to completion, forwarding every event to the window that asked for it.
 *
 * The `finally` is load-bearing three times over: it drops the run from the cancel table, it emits
 * the `end` marker the preload unsubscribes on, and — by leaving the `for await` — it triggers the
 * generator's own cleanup in `engine.ts`, which kills the child. A run whose window went away must
 * not leave a `claude -p` running against somebody's subscription.
 */
async function streamRun(
  sender: WebContents,
  request: AgentRunRequest,
  controller: AbortController,
  apiKey: string | undefined,
): Promise<AgentRunOutcome> {
  const adapter = findAdapter(request.providerId);
  if (!adapter) throw new Error(`Для «${request.providerId}» нет адаптера CLI.`);

  const channel = agentEventChannel(request.runId);
  // A window can be torn down between the check and the send, and a throw out of the `finally`
  // below would lose the run's outcome over a message nobody is left to read.
  const emit = (message: AgentStreamMessage): void => {
    if (sender.isDestroyed()) return;
    try {
      sender.send(channel, message);
    } catch {
      /* the window went away mid-send */
    }
  };

  // A reload or a closed window must stop the child, not orphan it.
  const onGone = (): void => controller.abort();
  sender.once('destroyed', onGone);

  try {
    for await (const event of runAgent({
      adapter,
      request: {
        prompt: request.prompt,
        cwd: request.cwd,
        ...(request.model === undefined ? {} : { model: request.model }),
        ...(request.agentMode === undefined ? {} : { agentMode: request.agentMode }),
      },
      mode: request.mode,
      ...(apiKey === undefined ? {} : { apiKey }),
      signal: controller.signal,
    })) {
      if (sender.isDestroyed()) break;
      emit({ runId: request.runId, type: 'event', event });
    }
  } catch (cause) {
    // The engine turns expected failures into `error` events; anything reaching here is unexpected,
    // and the renderer still gets it as an event rather than as a rejected invoke with a stack.
    emit({
      runId: request.runId,
      type: 'event',
      event: { kind: 'error', message: describe(cause) },
    });
  } finally {
    sender.removeListener('destroyed', onGone);
    runs.delete(request.runId);
    emit({ runId: request.runId, type: 'end' });
  }

  return { runId: request.runId, cancelled: controller.signal.aborted };
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

/**
 * Register the provider-layer handlers. Called once from `main/index.ts`.
 *
 * Grouped into a function rather than left at module scope because the set is large enough that
 * «which channels does the renderer have?» should be answerable by reading one place.
 */
export function registerAgentIpc(): void {
  /**
   * What is installed on this machine.
   *
   * Detection is a binary on PATH answering `--version` and nothing else — no credential file is
   * opened, no vendor config directory is read. See `packages/agents/src/detect.ts`.
   */
  ipcMain.handle('agents:detect', async (): Promise<IpcResult<readonly CliDetection[]>> => {
    try {
      return succeed(await detectAll());
    } catch (cause) {
      return fail(describe(cause));
    }
  });

  /** The catalogue, so the UI can show a refusal with its citation instead of hiding an option. */
  ipcMain.handle('agents:policy', (): IpcResult<AgentPolicyCatalog> =>
    succeed({
      providers: PROVIDERS,
      selectable: POLICY_SELECTABLE,
      needsConsent: POLICY_NEEDS_CONSENT,
      capabilities: CAPABILITIES,
    }),
  );

  /**
   * What the member picked on the composer chips, and the way to change it.
   *
   * A preference rather than a secret, so unlike a key it travels both ways — but it is still
   * re-validated on the way in and on the way back off disk, because the value it carries decides
   * how much authority a run has.
   */
  ipcMain.handle('agents:settings', async (): Promise<IpcResult<AgentSettings>> => {
    try {
      return succeed(await readAgentSettings());
    } catch (cause) {
      return fail(describe(cause));
    }
  });

  ipcMain.handle(
    'agents:setSettings',
    async (_event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<AgentSettings>> => {
      if (!isRecord(raw)) return fail('Некорректные настройки агента.');
      try {
        return succeed(
          await writeAgentSettings({
            agentMode: raw['agentMode'] as AgentPermission,
            models: (raw['models'] ?? {}) as Record<string, string>,
          }),
        );
      } catch (cause) {
        return fail(describe(cause));
      }
    },
  );

  ipcMain.handle(
    'agents:run',
    async (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<AgentRunOutcome>> => {
      const parsed = parseRunRequest(raw);
      if (!parsed.ok) return parsed;

      if (runs.has(parsed.value.runId)) return fail('Такой ран уже выполняется.');

      // The resolved path replaces the claimed one for the rest of the run, so the directory that
      // was checked is the directory the child gets — and the one that ends up in `--cd`.
      const cwd = await resolveRunCwd(parsed.value.cwd);
      if (!cwd.ok) return cwd;
      const request: AgentRunRequest = { ...parsed.value, cwd: cwd.value };

      // Both modes are gated on `local-agent-cli` because that is the only transport `runAgent`
      // implements today: `api-key` mode still starts the vendor's CLI, and merely hands it the
      // member's key instead of leaving it to find its own login. `direct-api` exists in the
      // vocabulary of `policy.ts` and in no adapter — see docs/HANDOFF.md.
      //
      // Asked here as well as inside `runAgent`: a refusal at the boundary is a sentence the member
      // reads before anything starts, which is the difference between «нельзя, вот почему» and a
      // failed run they have to interpret.
      const verdict = checkAllowed(request.providerId, 'local-agent-cli');
      if (!verdict.allowed) {
        // Without this the member picks «ключ», gets a paragraph about CLI prohibitions, and
        // reasonably concludes the app is broken rather than incomplete.
        return fail(
          request.mode === 'api-key'
            ? `Ключ пока не поможет: PartyCo умеет только запускать CLI вендора, а он здесь ` +
                `недоступен. ${verdict.reason}`
            : verdict.reason,
        );
      }

      if (!findAdapter(request.providerId)) {
        return fail(`Для «${request.providerId}» не реализован запуск CLI.`);
      }

      let apiKey: string | undefined;
      if (request.mode === 'api-key') {
        // The first run of a launch can arrive before the panel has asked for key status, so the
        // store is read here too rather than assumed loaded.
        await ensureKeysLoaded();
        apiKey = apiKeys.get(request.providerId);
        if (apiKey === undefined) {
          const provider = findProvider(request.providerId);
          return fail(
            `Ключ для «${provider?.label ?? request.providerId}» не задан — открой настройки ` +
              'провайдера и введи его.',
          );
        }
      }

      const controller = new AbortController();
      runs.set(request.runId, controller);
      try {
        return succeed(await streamRun(event.sender, request, controller, apiKey));
      } catch (cause) {
        runs.delete(request.runId);
        return fail(describe(cause));
      }
    },
  );

  ipcMain.handle('agents:cancel', (_event, rawRunId: unknown): IpcResult<AgentCancelOutcome> => {
    if (typeof rawRunId !== 'string' || !RUN_ID.test(rawRunId)) {
      return fail('Некорректный идентификатор рана.');
    }
    const controller = runs.get(rawRunId);
    // Cancelling a run that already finished is normal — the member pressed stop as it ended.
    if (!controller) return succeed({ cancelled: false });
    controller.abort();
    return succeed({ cancelled: true });
  });

  /**
   * Accept a key. There is no matching getter, and there will not be one.
   *
   * An empty string clears the key — from memory and from the disk store alike, so «убрать ключ»
   * needs no second channel and leaves nothing behind. No error message below echoes the value: a
   * key in an error string is a key in a log the moment anyone adds logging.
   *
   * Asynchronous now because storing it is a file write. The bridge always returned a promise, so
   * the contract is unchanged.
   */
  ipcMain.handle(
    'agents:setKey',
    async (_event, rawProviderId: unknown, rawKey: unknown): Promise<IpcResult<AgentKeyReport>> => {
      if (typeof rawProviderId !== 'string') return fail('Не указан провайдер.');
      const provider = findProvider(rawProviderId);
      if (!provider) return fail(`Провайдер «${rawProviderId}» не поддерживается.`);
      if (typeof rawKey !== 'string') return fail('Ключ должен быть строкой.');

      const key = rawKey.trim();
      // Shape first, disk second: a refused key must not cost a decryption, and must not be able to
      // reach the store at all.
      if (key.length > MAX_KEY_CHARS) {
        return fail('Это длиннее любого ключа — похоже, вставлен не ключ.');
      }
      if (CONTROL_CHARS.test(key)) {
        return fail('В ключе есть переносы строк или управляющие символы — проверь, что скопировано.');
      }

      // Loaded before the change, so writing back cannot drop the other providers' keys.
      await ensureKeysLoaded();
      if (key.length === 0) apiKeys.delete(provider.id);
      else apiKeys.set(provider.id, key);

      await persistKeys();
      return succeed(keyReport());
    },
  );

  /** Presence only. This is the entire read surface for keys. */
  ipcMain.handle('agents:keyStatus', async (): Promise<IpcResult<AgentKeyReport>> => {
    await ensureKeysLoaded();
    return succeed(keyReport());
  });
}

/**
 * Stop every in-flight run. Called on quit so no delegated CLI outlives the app that started it.
 */
export function abortAllAgentRuns(): void {
  for (const controller of runs.values()) controller.abort();
  runs.clear();
}
