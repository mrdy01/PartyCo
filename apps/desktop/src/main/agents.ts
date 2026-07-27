import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  POLICY_NEEDS_CONSENT,
  POLICY_SELECTABLE,
  PROVIDERS,
  checkAllowed,
  detectAll,
  findAdapter,
  findProvider,
  runAgent,
  type AgentEvent,
  type AuthMode,
  type CliDetection,
  type PolicyStatus,
  type ProviderPolicy,
} from '@partyco/agents';

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
 * and this file is where that promise is either kept or quietly broken.
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
}

/** One turn, as the renderer asks for it. Nothing here is trusted until `parseRunRequest` says so. */
export interface AgentRunRequest {
  /** Chosen by the preload, not the main process, so the renderer can subscribe before events flow. */
  runId: string;
  providerId: string;
  mode: AuthMode;
  prompt: string;
  /** Absolute path to an existing directory on this machine. */
  cwd: string;
  model?: string | undefined;
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
   * Always `false`, and typed as the literal so the UI cannot forget to say so. Keys live in this
   * process's memory: quitting the app forgets them, and a member re-enters the key next launch.
   * See the note on `apiKeys` for why nothing is written to disk yet.
   */
  persisted: false;
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
 * Member-supplied API keys, by provider id. **Memory only, on purpose.**
 *
 * There is no disk write here and no `localStorage` mirror: a key in `localStorage` is a key inside
 * the renderer, which is exactly the boundary this file exists to hold. When persistence is added it
 * has to go through Electron's `safeStorage` (OS keychain / DPAPI) and stay on this side of the
 * bridge — the renderer's view must remain `hasKey: boolean` either way.
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
 * Not a policy preference — a Windows fact. The prompt is passed as an argv element (never through a
 * shell), and `CreateProcess` caps the whole command line at 32767 characters. Past that the spawn
 * fails with something unreadable, or on some shells silently truncates the question. A stated limit
 * is a better bug report than either.
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
 * `cwd` is checked for shape here and for existence in `validateCwd` — the filesystem call is async
 * and every other check is not, so the cheap refusals happen first.
 */
function parseRunRequest(raw: unknown): IpcResult<AgentRunRequest> {
  if (!isRecord(raw)) return fail('Некорректный запрос: ожидался объект.');

  const { runId, providerId, mode, prompt, cwd, model } = raw;

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
      `Запрос длиннее ${MAX_PROMPT_CHARS} символов. Командная строка Windows ограничена 32767 ` +
        'символами, и такой запрос до агента не доедет — сократи его или положи текст в файл ' +
        'внутри рабочей директории и сошлись на него.',
    );
  }

  if (typeof cwd !== 'string' || cwd.length === 0) return fail('Не указана рабочая директория.');

  if (model !== undefined && (typeof model !== 'string' || !MODEL_ID.test(model))) {
    return fail('Некорректный идентификатор модели.');
  }

  return succeed({
    runId,
    providerId: provider.id,
    mode: mode as AuthMode,
    prompt,
    cwd,
    ...(typeof model === 'string' ? { model } : {}),
  });
}

/**
 * The directory the agent will be able to read and write.
 *
 * Absolute, existing, and a directory — three separate failures with three separate sentences,
 * because «не работает» is what a member reports when the app collapses them into one.
 */
async function validateCwd(cwd: string): Promise<string | null> {
  if (!isAbsolute(cwd)) {
    return `Рабочая директория должна быть абсолютным путём, а получено «${cwd}».`;
  }
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(cwd)).isDirectory();
  } catch {
    return `Директория «${cwd}» не существует или недоступна.`;
  }
  if (!isDirectory) return `«${cwd}» — это не директория.`;
  return null;
}

function keyReport(): AgentKeyReport {
  return {
    keys: PROVIDERS.map((provider) => ({
      providerId: provider.id,
      hasKey: apiKeys.has(provider.id),
    })),
    persisted: false,
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
    }),
  );

  ipcMain.handle(
    'agents:run',
    async (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<AgentRunOutcome>> => {
      const parsed = parseRunRequest(raw);
      if (!parsed.ok) return parsed;
      const request = parsed.value;

      if (runs.has(request.runId)) return fail('Такой ран уже выполняется.');

      const cwdError = await validateCwd(request.cwd);
      if (cwdError !== null) return fail(cwdError);

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
        apiKey = apiKeys.get(request.providerId);
        if (apiKey === undefined) {
          const provider = findProvider(request.providerId);
          return fail(
            `Ключ для «${provider?.label ?? request.providerId}» не задан. Ключи не сохраняются ` +
              'между запусками — введи его в настройках провайдера.',
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
   * An empty string clears the key, so «убрать ключ» needs no second channel. No error message
   * below echoes the value — a key in an error string is a key in a log the moment anyone adds
   * logging.
   */
  ipcMain.handle(
    'agents:setKey',
    (_event, rawProviderId: unknown, rawKey: unknown): IpcResult<AgentKeyReport> => {
      if (typeof rawProviderId !== 'string') return fail('Не указан провайдер.');
      const provider = findProvider(rawProviderId);
      if (!provider) return fail(`Провайдер «${rawProviderId}» не поддерживается.`);
      if (typeof rawKey !== 'string') return fail('Ключ должен быть строкой.');

      const key = rawKey.trim();
      if (key.length === 0) {
        apiKeys.delete(provider.id);
        return succeed(keyReport());
      }
      if (key.length > MAX_KEY_CHARS) {
        return fail('Это длиннее любого ключа — похоже, вставлен не ключ.');
      }
      if (CONTROL_CHARS.test(key)) {
        return fail('В ключе есть переносы строк или управляющие символы — проверь, что скопировано.');
      }

      apiKeys.set(provider.id, key);
      return succeed(keyReport());
    },
  );

  /** Presence only. This is the entire read surface for keys. */
  ipcMain.handle('agents:keyStatus', (): IpcResult<AgentKeyReport> => succeed(keyReport()));
}

/**
 * Stop every in-flight run. Called on quit so no delegated CLI outlives the app that started it.
 */
export function abortAllAgentRuns(): void {
  for (const controller of runs.values()) controller.abort();
  runs.clear();
}
