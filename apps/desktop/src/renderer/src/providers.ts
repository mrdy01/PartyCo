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
  busyProviderId: string | null;
  setMode: (providerId: string, mode: ProviderMode) => void;
  submitKey: (providerId: string, key: string) => void;
  redetect: () => void;
}

export function useProviderLayer(): ProviderLayer {
  const [providers, setProviders] = useState<readonly ProviderSetupItem[]>([]);
  const [state, setState] = useState<ProviderSetupState>('loading');
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [modes, setModes] = useState<Record<string, ProviderMode>>({});
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const bridge = window.partyco?.agents;
    // Running under `dev:web`, in a plain browser: there is no main process, so nothing can be
    // detected and no key can be stored. The panel's own empty state covers it — an empty list is
    // the truth here, not a failure.
    if (!bridge) {
      setProviders([]);
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
        if (keys.ok) for (const k of keys.value.keys) hasKeyById.set(k.providerId, k.hasKey);

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
    if (!bridge) return;
    setBusyProviderId(providerId);
    void bridge
      .setKey(providerId, key)
      .then((result) => {
        if (!result.ok) return;
        const hasKeyById = new Map(result.value.keys.map((k) => [k.providerId, k.hasKey]));
        setProviders((current) =>
          current.map((p) => ({ ...p, hasKey: hasKeyById.get(p.id) ?? p.hasKey })),
        );
      })
      .finally(() => setBusyProviderId(null));
  }, []);

  const redetect = useCallback(() => setNonce((n) => n + 1), []);

  return { providers, state, busyProviderId, setMode, submitKey, redetect };
}
