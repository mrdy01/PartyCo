/**
 * The provider layer, as the renderer sees it.
 *
 * Three shapes have to meet here and none of them is quite the others: `@partyco/agents` describes
 * vendor policy, `main/agents.ts` describes what this machine has installed, and `ProviderSetup`
 * describes what to draw. This hook is the seam, and it is on this side of the bridge on purpose —
 * the panel stays ignorant of IPC (CONVENTIONS §8) and the main process stays ignorant of layout.
 *
 * The one thing that never travels through here is a key. `setKey` sends one across the bridge and
 * gets back a count; there is no call that returns a secret, because the main process does not
 * expose one. That asymmetry is the product promise — keys do not leave this machine, and they do
 * not enter the web content either.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ProviderMode, ProviderSetupItem, ProviderSetupState } from '@partyco/ui';
import type { AgentPermission, ProviderCapability } from './bridge';

/**
 * What the detector found, keyed by provider.
 *
 * Note there is no sign-in state: `detect.ts` reports `auth: 'unknown'` and this seam does not try
 * to improve on that. Knowing whether somebody is signed in would mean reading their credentials or
 * spending their tokens, and the first is forbidden outright.
 */
type Detection = { found: boolean; version?: string; installHint?: string };

export interface ProviderLayer {
  providers: readonly ProviderSetupItem[];
  state: ProviderSetupState;
  /**
   * Whether a saved key survives quitting the app.
   *
   * `undefined` until the main process has answered, because the two real answers lead to opposite
   * sentences and neither may be guessed: on a machine whose OS refuses to encrypt, a key is *not*
   * stored, and a person who was told otherwise finds an empty field next launch with no idea why.
   */
  keysPersisted: boolean | undefined;
  busyProviderId: string | null;
  /**
   * Why the last `setKey` did not store anything, and for which provider.
   *
   * The main process answers a refusal in its own Russian sentence — the store would not encrypt,
   * the provider id is not in the catalogue — and until now this hook dropped it on the floor
   * (`if (!result.ok) return`). The panel then showed a cleared field, «Ключа пока нет» and no
   * explanation, which is indistinguishable from a save that worked and from one that was never
   * attempted. Cleared to `null` at the start of every attempt.
   */
  keyError: { providerId: string; message: string } | null;
  setMode: (providerId: string, mode: ProviderMode) => void;
  submitKey: (providerId: string, key: string) => void;
  redetect: () => void;

  /**
   * What each provider may actually be asked for. Empty until the main process has answered.
   *
   * Carried over IPC rather than imported, because `@partyco/agents` reaches `node:child_process`
   * through its barrel and this file runs in web content.
   */
  capabilities: readonly ProviderCapability[];
  /** How much the agent may do, as the composer chip says it. Remembered between launches. */
  agentMode: AgentPermission;
  setAgentMode: (mode: AgentPermission) => void;
  /** Chosen model alias per provider. Absent ⇒ the CLI picks, and the chip says so. */
  models: Readonly<Record<string, string>>;
  setModel: (providerId: string, modelId: string | null) => void;
}

/**
 * What step 2 of first run says for the same cause, kept in the same words on purpose: the bridge
 * is missing, so no key can be stored, and the reader is told to skip rather than to retry.
 */
const AGENTS_UNAVAILABLE =
  'Приложение не смогло связаться со своей системной частью, поэтому ключ не сохранён. ' +
  'Если это повторится, переустанови PartyCo.';

export function useProviderLayer(): ProviderLayer {
  const [providers, setProviders] = useState<readonly ProviderSetupItem[]>([]);
  const [keysPersisted, setKeysPersisted] = useState<boolean | undefined>(undefined);
  const [state, setState] = useState<ProviderSetupState>('loading');
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<{ providerId: string; message: string } | null>(null);
  const [modes, setModes] = useState<Record<string, ProviderMode>>({});
  const [nonce, setNonce] = useState(0);
  const [capabilities, setCapabilities] = useState<readonly ProviderCapability[]>([]);
  const [agentMode, setAgentModeState] = useState<AgentPermission>('plan');
  const [models, setModels] = useState<Readonly<Record<string, string>>>({});

  /*
   * The remembered chips, read once per launch.
   *
   * Read before anything can be sent rather than lazily: a turn that goes out with the default while
   * the member's own choice is still in flight would run under an authority they did not pick, and
   * the chip would be showing the right answer at the time.
   */
  useEffect(() => {
    const bridge = window.partyco?.agents;
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .settings()
      .then((result) => {
        if (cancelled || !result.ok) return;
        setAgentModeState(result.value.agentMode);
        setModels(result.value.models);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const bridge = window.partyco?.agents;
    // Running under `dev:web`, in a plain browser: there is no main process, so nothing can be
    // detected and no key can be stored. The panel's own empty state covers it — an empty list is
    // the truth here, not a failure.
    if (!bridge) {
      setProviders([]);
      // Not `false`: nothing was asked, so nothing is known. `false` here would print «сохранить не
      // получится» in a browser where no key can be entered in the first place.
      setKeysPersisted(undefined);
      setState('ready');
      return;
    }

    let cancelled = false;
    setState('loading');

    void Promise.all([bridge.policy(), bridge.detect(), bridge.keyStatus()])
      .then(([policy, detected, keys]) => {
        if (cancelled) return;
        if (!policy.ok) {
          setState('error');
          return;
        }
        setCapabilities(policy.value.capabilities);

        const detectionById = new Map<string, Detection>();
        if (detected.ok) {
          for (const entry of detected.value) {
            detectionById.set(entry.providerId, {
              found: entry.installed,
              ...(entry.version ? { version: entry.version } : {}),
              // The detector's `hint` covers both "not found, install it like this" and "found, but
              // it is an npm shim Windows cannot start". Both are install advice to the reader.
              ...(entry.hint ? { installHint: entry.hint } : {}),
            });
          }
        }

        const hasKeyById = new Map<string, boolean>();
        if (keys.ok) {
          for (const k of keys.value.keys) hasKeyById.set(k.providerId, k.hasKey);
          setKeysPersisted(keys.value.persisted);
        }

        setProviders(
          policy.value.providers.map((provider) => {
            const api = provider.transports.find((t) => t.transport === 'direct-api');
            const cli = provider.transports.find((t) => t.transport === 'local-agent-cli');
            const detection = detectionById.get(provider.id);
            return {
              id: provider.id,
              label: provider.label,
              glyph: provider.label.slice(0, 1),
              apiKeyHint: provider.apiKeyHint,
              apiKeyEnv: provider.apiKeyEnv,
              apiKey: {
                status: api?.status ?? 'prohibited',
                summary: api?.summary ?? '',
                source: api?.source ?? '',
              },
              ...(cli
                ? {
                    cli: {
                      status: cli.status,
                      summary: cli.summary,
                      source: cli.source,
                      ...(cli.expiry ? { expiry: cli.expiry } : {}),
                      ...(provider.cliBinary ? { binary: provider.cliBinary } : {}),
                    },
                  }
                : {}),
              ...(provider.cliBinary && detection
                ? { detection: { binary: provider.cliBinary, ...detection } }
                : {}),
              hasKey: hasKeyById.get(provider.id) ?? false,
              ...(modes[provider.id] ? { mode: modes[provider.id] as ProviderMode } : {}),
            } satisfies ProviderSetupItem;
          }),
        );
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
    // `modes` is deliberately absent: choosing a mode is local state and must not re-run detection,
    // which spawns processes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const setMode = useCallback((providerId: string, mode: ProviderMode) => {
    setModes((current) => ({ ...current, [providerId]: mode }));
    setProviders((current) =>
      current.map((p) => (p.id === providerId ? { ...p, mode } : p)),
    );
  }, []);

  const submitKey = useCallback((providerId: string, key: string) => {
    const bridge = window.partyco?.agents;
    setKeyError(null);
    if (!bridge) {
      // The panel has already dropped the key by the time this runs — that is its hygiene rule —
      // so returning quietly would leave a person who just typed a secret believing it was taken.
      setKeyError({ providerId, message: AGENTS_UNAVAILABLE });
      return;
    }
    setBusyProviderId(providerId);
    void bridge
      .setKey(providerId, key)
      .then((result) => {
        if (!result.ok) {
          // The store's own sentence, carried through unchanged. Paraphrasing «система отказалась
          // зашифровать ключ» into «не удалось сохранить» would delete the one part a person can
          // act on.
          setKeyError({ providerId, message: result.error });
          return;
        }
        // Saving is the moment the answer can change — a store that was writable at startup may not
        // be now, and the panel has to stop promising what just failed.
        setKeysPersisted(result.value.persisted);
        const hasKeyById = new Map(result.value.keys.map((k) => [k.providerId, k.hasKey]));
        setProviders((current) =>
          current.map((p) => ({ ...p, hasKey: hasKeyById.get(p.id) ?? p.hasKey })),
        );
      })
      // A rejected `invoke` — no handler registered, the main process gone — used to escape as an
      // unhandled rejection and leave the panel just as silent as a refusal did.
      .catch((cause: unknown) => {
        setKeyError({
          providerId,
          message: cause instanceof Error ? cause.message : 'Ключ не сохранён: основной процесс не ответил.',
        });
      })
      .finally(() => setBusyProviderId(null));
  }, []);

  const redetect = useCallback(() => setNonce((n) => n + 1), []);

  /*
   * The screen changes first, the disk second.
   *
   * A chip that waited for a file write before repainting would lag behind the click on a slow disk,
   * and the member would click twice. A failed write costs the choice at next launch and nothing in
   * this session — the run already carries the value from state, not from the file.
   */
  const persist = useCallback((next: { agentMode: AgentPermission; models: Record<string, string> }) => {
    void window.partyco?.agents?.setSettings(next).catch(() => undefined);
  }, []);

  const setAgentMode = useCallback(
    (next: AgentPermission) => {
      setAgentModeState(next);
      setModels((current) => {
        persist({ agentMode: next, models: { ...current } });
        return current;
      });
    },
    [persist],
  );

  const setModel = useCallback(
    (providerId: string, modelId: string | null) => {
      setModels((current) => {
        const next = { ...current };
        // `null` is «пусть выбирает CLI», which is the absence of a value rather than a value called
        // "default" — so the key goes away instead of holding a word the adapter would then send.
        if (modelId === null) delete next[providerId];
        else next[providerId] = modelId;
        setAgentModeState((mode) => {
          persist({ agentMode: mode, models: next });
          return mode;
        });
        return next;
      });
    },
    [persist],
  );

  return {
    providers,
    state,
    keysPersisted,
    busyProviderId,
    keyError,
    setMode,
    submitKey,
    redetect,
    capabilities,
    agentMode,
    setAgentMode,
    models,
    setModel,
  };
}
