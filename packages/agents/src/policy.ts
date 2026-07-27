/**
 * Which ways of reaching a model are allowed, and by whose word.
 *
 * This file is a **catalogue of vendor policy as data**, not a set of switches. Every entry records
 * what the vendor actually wrote and where, so that enabling or refusing a transport is a lookup
 * rather than an argument. `docs/providers-and-subscription-legality.md` carries the full citations;
 * what is here is the part the running code has to consult.
 *
 * The distinction that makes this necessary: two vendors can offer the same technical capability and
 * mean opposite things by it. Spawning a locally-installed CLI is how OpenClaw and Conductor reach
 * Anthropic and neither was ever blocked; doing the same against Google's consumer tier has already
 * cost people permanent account bans. A boolean cannot hold that difference. A citation can.
 */

/**
 * How the model call physically happens.
 *
 * `local-agent-acp` and `gateway` are in the vocabulary because the architecture commits to them, but
 * no adapter implements them yet — see `docs/HANDOFF.md`.
 */
export type Transport = 'direct-api' | 'local-agent-cli' | 'local-agent-acp' | 'gateway';

/**
 * The vendor's own position on a transport, in descending order of certainty.
 *
 * `tolerated-undocumented` is the honest label for the delegated-CLI path at Anthropic: their
 * documents neither permit nor forbid a local program spawning the CLI a member installed and signed
 * into themselves, and every product doing exactly that survived the 2026 enforcement rounds that
 * killed the products doing something else. It is not a permission. It is an observation, and it is
 * labelled as one so that nobody later mistakes it for a permission.
 */
export type PolicyStatus =
  | 'documented-allowed'
  | 'documented-embedding'
  | 'tolerated-undocumented'
  | 'requires-approval'
  | 'prohibited';

/** Whether a member may turn this on, and how loudly we have to warn them first. */
export const POLICY_SELECTABLE: Record<PolicyStatus, boolean> = {
  'documented-allowed': true,
  'documented-embedding': true,
  'tolerated-undocumented': true,
  'requires-approval': false,
  prohibited: false,
};

/** Transports a member may only reach past an explicit, informed consent step. */
export const POLICY_NEEDS_CONSENT: Record<PolicyStatus, boolean> = {
  'documented-allowed': false,
  'documented-embedding': true,
  'tolerated-undocumented': true,
  'requires-approval': true,
  prohibited: true,
};

export interface TransportPolicy {
  transport: Transport;
  status: PolicyStatus;
  /** Where the vendor said it. Shown in the UI next to the consent text — claims carry their source. */
  source: string;
  /** One sentence a person can act on. Russian: this reaches the interface. */
  summary: string;
  /**
   * A vendor-announced change that will break this transport. Present on the Anthropic CLI path
   * because the headless docs state `--bare` "will become the default for `-p` in a future release",
   * and `--bare` skips OAuth entirely — i.e. the delegated path has a published end date.
   */
  expiry?: string;
}

export interface ProviderPolicy {
  id: string;
  label: string;
  /** Binary the member installs and signs into themselves. Absent when there is no CLI path at all. */
  cliBinary?: string;
  /** Environment variable the direct-api transport reads the member's key from. */
  apiKeyEnv: string;
  /** Shape of the key, shown as a placeholder so a wrong-vendor paste is obvious before submit. */
  apiKeyHint: string;
  transports: readonly TransportPolicy[];
}

/**
 * Anthropic, OpenAI, Google.
 *
 * Google is in the catalogue specifically so that its CLI path can be **refused with a reason**
 * rather than quietly omitted: consumer Gemini CLI OAuth stopped serving AI Pro/Ultra in June 2026,
 * Google's terms forbid "using the Service in connection with products not provided by us", and it is
 * the one vendor that has already issued permanent bans for a second offence. An absent entry teaches
 * the next reader nothing; a `prohibited` entry with a citation teaches them not to try.
 */
export const PROVIDERS: readonly ProviderPolicy[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    cliBinary: 'claude',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    apiKeyHint: 'sk-ant-api03-…',
    transports: [
      {
        transport: 'direct-api',
        status: 'documented-allowed',
        source: 'https://code.claude.com/docs/en/legal-and-compliance',
        summary:
          'Ключ из Claude Console. Единственный способ, про который вендор написал «используйте этот».',
      },
      {
        transport: 'local-agent-cli',
        status: 'tolerated-undocumented',
        source: 'https://code.claude.com/docs/en/headless',
        summary:
          'Запускаем Claude Code, который ты уже установил и в который сам вошёл. PartyCo не видит твой логин и не делает запросов к Anthropic — их делает сам Claude Code, с твоей подпиской.',
        expiry:
          'Anthropic объявила, что флаг --bare станет поведением по умолчанию для -p; он пропускает OAuth и требует API-ключ. У этого режима есть срок годности, назначенный вендором.',
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    cliBinary: 'codex',
    apiKeyEnv: 'OPENAI_API_KEY',
    apiKeyHint: 'sk-proj-…',
    transports: [
      {
        transport: 'direct-api',
        status: 'documented-allowed',
        source: 'https://platform.openai.com/docs/api-reference',
        summary: 'Ключ из платформы OpenAI. Оплата по токенам, работает без установленного Codex.',
      },
      {
        transport: 'local-agent-cli',
        status: 'documented-embedding',
        source: 'https://developers.openai.com/codex/sdk',
        summary:
          'Запускаем Codex, который ты установил и в который сам вошёл. OpenAI — единственный из трёх, кто описал встраивание в чужой продукт как штатный сценарий.',
      },
    ],
  },
  {
    id: 'google',
    label: 'Google',
    cliBinary: 'gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    apiKeyHint: 'AIza…',
    transports: [
      {
        transport: 'direct-api',
        status: 'documented-allowed',
        source: 'https://ai.google.dev/gemini-api/docs',
        summary: 'Ключ из Google AI Studio. Оплата по токенам.',
      },
      {
        transport: 'local-agent-cli',
        status: 'prohibited',
        source: 'https://geminicli.com/docs/resources/tos-privacy/',
        summary:
          'Google запрещает доступ к сервисам Gemini CLI из сторонних программ и уже выдавала постоянные баны за повторное нарушение. Этот путь в PartyCo не реализован намеренно — используй ключ из AI Studio.',
      },
    ],
  },
];

export function findProvider(id: string): ProviderPolicy | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function findTransportPolicy(
  providerId: string,
  transport: Transport,
): TransportPolicy | undefined {
  return findProvider(providerId)?.transports.find((t) => t.transport === transport);
}

/**
 * The gate every call site must pass before a transport is used.
 *
 * Returns a reason rather than a boolean so the refusal can be shown to the person verbatim. A
 * refusal a user cannot read is a bug report waiting to happen.
 */
export function checkAllowed(
  providerId: string,
  transport: Transport,
): { allowed: true } | { allowed: false; reason: string } {
  const provider = findProvider(providerId);
  if (!provider) return { allowed: false, reason: `Провайдер «${providerId}» не поддерживается.` };

  const policy = provider.transports.find((t) => t.transport === transport);
  if (!policy) {
    return {
      allowed: false,
      reason: `У «${provider.label}» нет режима «${transport}» — он не реализован.`,
    };
  }
  if (!POLICY_SELECTABLE[policy.status]) {
    return { allowed: false, reason: policy.summary };
  }
  return { allowed: true };
}
