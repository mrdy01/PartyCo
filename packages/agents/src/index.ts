/**
 * `@partyco/agents` — the provider layer.
 *
 * Runs on the member's machine and reaches a model in one of two ways: an **API key** the member
 * gave us, or a **CLI the member installed and signed into themselves**, which we start as a child
 * process and read.
 *
 * What this package deliberately cannot do is as important as what it does. There is no code path
 * here that reads a credential file, opens a keychain, runs an OAuth flow, or makes an HTTP request
 * to a vendor. In delegated mode the child process receives no credential material at all — it finds
 * its own, because the person signed into it. That is the entire mechanism, and it is the one that
 * survived 2026's enforcement while products that did something cleverer were blocked server-side.
 *
 * See `docs/providers-and-subscription-legality.md` for the vendor citations behind every status in
 * `policy.ts`.
 */

export {
  PROVIDERS,
  POLICY_SELECTABLE,
  POLICY_NEEDS_CONSENT,
  findProvider,
  findTransportPolicy,
  checkAllowed,
  type Transport,
  type PolicyStatus,
  type TransportPolicy,
  type ProviderPolicy,
} from './policy.ts';

export {
  buildAgentEnv,
  assertNoLeakedCredentials,
  CREDENTIAL_ENV_DENYLIST,
  type AuthMode,
  type BuildEnvOptions,
} from './env.ts';

export {
  runAgent,
  type AgentAdapter,
  type AgentEvent,
  type AgentRequest,
  type TextEvent,
  type ToolEvent,
  type ResultEvent,
  type ErrorEvent,
  type CancelledEvent,
  type RunOptions,
} from './engine.ts';

export { detectCli, detectAll, type CliDetection } from './detect.ts';

export { claudeAdapter } from './adapters/claude.ts';
export { codexAdapter } from './adapters/codex.ts';

import { claudeAdapter } from './adapters/claude.ts';
import { codexAdapter } from './adapters/codex.ts';
import type { AgentAdapter } from './engine.ts';

/**
 * Adapters by provider id.
 *
 * Google is absent by design rather than by omission: its CLI transport is `prohibited` in
 * `policy.ts`, so there is nothing to route to. `checkAllowed` explains why to anyone who asks.
 */
export const ADAPTERS: Readonly<Record<string, AgentAdapter>> = {
  [claudeAdapter.providerId]: claudeAdapter,
  [codexAdapter.providerId]: codexAdapter,
};

export function findAdapter(providerId: string): AgentAdapter | undefined {
  return ADAPTERS[providerId];
}
