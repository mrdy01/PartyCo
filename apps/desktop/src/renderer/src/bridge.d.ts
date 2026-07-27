import type { PartyCoBridge } from '../../preload/index.ts';

declare global {
  interface Window {
    /**
     * Optional, because it genuinely can be absent.
     *
     * `npm run dev:web` renders this same tree in a plain browser with no preload at all, and a
     * preload that fails to load leaves the property undefined in Electron too — which is exactly
     * what an ESM preload under `sandbox: true` used to do here silently. Declaring it as always
     * present made every consumer's `if (!window.partyco)` look like dead code to the compiler and
     * let a genuinely unguarded call type-check. It is optional so the guard is required.
     */
    partyco?: PartyCoBridge | undefined;
  }
}

/**
 * Re-exports, so a screen writes `import type { AgentEvent } from '@/bridge'` instead of reaching
 * into the preload or into `@partyco/agents` directly. The renderer has no business importing the
 * provider package for anything but its shapes, and a single import path makes that visible in
 * review.
 *
 * `AuthMode` is renamed on the way through: `@partyco/ui` exports a type with that name already
 * (the sign-in screen's login-vs-register switch), and two unrelated `AuthMode`s in one file is a
 * misreading waiting to happen.
 */
export type {
  AgentCancelOutcome,
  AgentKeyReport,
  AgentKeyState,
  AgentPolicyCatalog,
  AgentRun,
  AgentRunInput,
  AgentRunOutcome,
  AgentsBridge,
  IpcResult,
  PartyCoBridge,
} from '../../preload/index.ts';

export type {
  AgentEvent,
  CliDetection,
  ErrorEvent as AgentErrorEvent,
  PolicyStatus,
  ProviderPolicy,
  ResultEvent as AgentResultEvent,
  TextEvent as AgentTextEvent,
  ToolEvent as AgentToolEvent,
  Transport,
  TransportPolicy,
  AuthMode as AgentAuthMode,
} from '@partyco/agents';
