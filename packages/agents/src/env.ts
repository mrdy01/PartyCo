/**
 * The environment a delegated agent process is allowed to see.
 *
 * This is the most security-critical file in the package, and the reason is a billing trap rather
 * than a breach. Claude Code resolves its credentials in a documented order — cloud-provider vars,
 * then `ANTHROPIC_AUTH_TOKEN`, then `ANTHROPIC_API_KEY`, then `apiKeyHelper`, then
 * `CLAUDE_CODE_OAUTH_TOKEN`, and only last the subscription login from `/login`. So a single
 * inherited variable moves a member off the flat-rate plan they chose and onto metered billing
 * against whoever owns that key. Nothing fails. The run succeeds. Only the invoice differs, and it
 * differs a month later.
 *
 * The defence is that the child's environment is **built**, never inherited: an allowlist passes a
 * small set of variables a CLI genuinely needs to run, and everything else — including every
 * credential-bearing variable of every vendor — simply never exists in the child. The denylist below
 * is therefore redundant by construction, and it is kept anyway, asserted by a test, because the
 * failure mode of someone later widening the allowlist without thinking is silent.
 */

import { PROVIDERS } from './policy.ts';

/**
 * How the spawned CLI should authenticate.
 *
 * `subscription` is the delegated path: the member signed into the vendor's binary themselves and we
 * must not hand it anything that would override that. `api-key` is the documented path: the member
 * gave us a key for this provider and we pass exactly that one.
 */
export type AuthMode = 'subscription' | 'api-key';

/**
 * Variables a CLI needs in order to start at all: find its own binary and interpreter, locate the
 * user's config, write temp files, and traverse a corporate proxy.
 *
 * Deliberately absent: `NODE_OPTIONS` (arbitrary flag injection into a Node-based CLI),
 * `CLAUDE_CONFIG_DIR` and its siblings (they redirect where the vendor binary looks for credentials
 * — not our business to influence), and every `*_API_KEY` / `*_TOKEN` in existence.
 */
const BASE_ALLOWLIST: readonly string[] = [
  // Everywhere
  'PATH',
  'HOME',
  'LANG',
  'TERM',
  'TZ',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  // POSIX
  'SHELL',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  // Windows — a process missing these does not merely misbehave, it fails to start
  'SystemRoot',
  'SystemDrive',
  'windir',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'USERPROFILE',
  'USERNAME',
  'USERDOMAIN',
  'HOMEDRIVE',
  'HOMEPATH',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
];

/**
 * Variables that must never reach a delegated child, restated explicitly.
 *
 * Every entry either carries a credential or silently redirects where credentials come from. The
 * cloud-provider switches are here because setting one makes Claude Code authenticate against
 * Bedrock/Vertex/Foundry instead of the member's subscription — same class of surprise, different
 * invoice.
 */
export const CREDENTIAL_ENV_DENYLIST: readonly string[] = [
  // Anthropic
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  // OpenAI
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'CODEX_ACCESS_TOKEN',
  'CODEX_APP_SERVER_LOGIN_CLIENT_ID',
  // Google
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_GENAI_USE_VERTEXAI',
  // Cloud credentials a vendor CLI may pick up on its own
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AZURE_CLIENT_SECRET',
];

export interface BuildEnvOptions {
  /** Provider whose CLI is being started, e.g. `anthropic`. */
  providerId: string;
  mode: AuthMode;
  /**
   * The member's key. Required for `api-key`, and **must be absent** for `subscription` — passing
   * one there is the billing trap this module exists to prevent, so it throws rather than warns.
   */
  apiKey?: string;
  /** Source environment. Defaults to this process's, but injectable so the rule is testable. */
  source?: NodeJS.ProcessEnv;
  /** Extra non-secret variables a caller needs, still filtered through the denylist. */
  extra?: Record<string, string>;
}

/**
 * Build the child environment.
 *
 * Note what this function cannot do: there is no code path that reads a credential file, a keychain,
 * or a vendor config directory. In `subscription` mode the child receives no credential material
 * whatsoever — it finds its own, because the member signed into it themselves. That is the whole
 * mechanism, and its simplicity is the point.
 */
export function buildAgentEnv(options: BuildEnvOptions): Record<string, string> {
  const { providerId, mode, apiKey, source = process.env, extra } = options;

  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  if (mode === 'subscription' && apiKey) {
    throw new Error(
      'buildAgentEnv: an API key was supplied for subscription mode. That key would take precedence ' +
        'over the member’s subscription login and silently move them to metered billing — refusing.',
    );
  }
  if (mode === 'api-key' && !apiKey) {
    throw new Error(`buildAgentEnv: mode "api-key" requires a key for ${provider.label}.`);
  }

  const env: Record<string, string> = {};
  for (const name of BASE_ALLOWLIST) {
    const value = source[name];
    if (typeof value === 'string' && value.length > 0) env[name] = value;
  }

  const denied = new Set(CREDENTIAL_ENV_DENYLIST);
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (denied.has(name)) {
      throw new Error(`buildAgentEnv: refusing to pass credential variable "${name}" to a child process.`);
    }
    if (typeof value === 'string') env[name] = value;
  }

  // The one credential we ever set, and only when the member explicitly chose this mode and gave us
  // this key. It is written here and nowhere else — never logged, never persisted by this package.
  if (mode === 'api-key' && apiKey) env[provider.apiKeyEnv] = apiKey;

  return env;
}

/**
 * Assert that a built environment carries nothing it should not.
 *
 * Exists as a runtime check, not only a test helper: the process spawner calls it immediately before
 * `spawn`, so a future refactor that widens the allowlist fails loudly at the boundary instead of
 * quietly re-routing somebody's billing.
 */
export function assertNoLeakedCredentials(
  env: Record<string, string>,
  allowedKeyVar?: string,
): void {
  for (const name of CREDENTIAL_ENV_DENYLIST) {
    if (name === allowedKeyVar) continue;
    if (name in env) {
      throw new Error(`Credential variable "${name}" leaked into an agent environment — refusing to spawn.`);
    }
  }
}
