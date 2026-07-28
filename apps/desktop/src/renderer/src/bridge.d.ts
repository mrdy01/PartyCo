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
  AgentSettings,
  AgentsBridge,
  IpcResult,
  PartyCoBridge,
} from '../../preload/index.ts';

/**
 * The cross-process vocabulary. Declared in `preload/contracts.ts` because that is the one directory
 * both tsconfigs see; re-exported here so a screen never reaches across the process boundary in an
 * import path. `IpcResult` is deliberately absent — the preload already re-exports one by that name,
 * and two identical envelopes under one name in one file would only invite a wrong fix later.
 */
export type {
  Page,
  TranscriptBridge,
  TranscriptEntry,
  WorkspaceBridge,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceInfo,
} from '../../preload/contracts.ts';

export type {
  AgentEvent,
  AgentPermission,
  ModelChoice,
  ProviderCapability,
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
