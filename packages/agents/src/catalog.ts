/**
 * What each provider can actually be asked for — models and permission modes.
 *
 * This file exists so that a menu never offers a row the adapter cannot emit. The rule it enforces
 * is the owner's: a control either works or does not look like one. A menu is a control made of
 * rows, so the rule applies per row, and the only way to keep it is for the list of rows and the
 * list of things `buildArgs` can produce to come from the same place. A test asserts exactly that
 * for every entry below.
 *
 * **The lists are short on purpose, and shortness is the honest state rather than a gap.**
 *
 *  - Anthropic's aliases are the four the installed CLI prints for `--model`: "Provide an alias for
 *    the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name (e.g.
 *    'claude-fable-5')". An alias resolves to whatever the vendor currently points it at — verified
 *    on 2.1.220, where `--model haiku` came back in the CLI's own `init` line as
 *    `claude-haiku-4-5-20251001`. Naming aliases rather than pinned ids means this list does not
 *    quietly rot into a menu of models the member's plan no longer includes.
 *  - Codex has no alias list this package can substantiate, so it offers none. Copying one out of a
 *    design fixture would be a claim about somebody else's product that nobody here checked.
 *  - No price and no context window against any row. Those are facts about the member's own billing
 *    and the vendor's current configuration; we neither read a credential nor call a vendor, so we
 *    do not know them, and a number nobody verified is worse on this screen than no number.
 *
 * Permission modes: Anthropic accepts the three PartyCo sanctions. Codex accepts none — it has no
 * `--permission-mode`, and mapping the modes onto `--sandbox` would silently redefine a vendor's
 * sandbox scope as an approval policy. The empty list is what makes its menu say so out loud
 * instead of offering three rows that change nothing.
 */

import type { AgentPermission } from './engine.ts';

/** One thing the member may pick, as the vendor names it. */
export interface ModelChoice {
  /** Value for `--model`. An alias, not a pinned id — see the note above. */
  id: string;
  /** What the chip says once it is chosen. */
  label: string;
  /** One line in the menu: what this model is for, in the vendor's own framing. */
  note: string;
}

export interface ProviderCapability {
  providerId: string;
  /**
   * Models offered. Empty ⇒ the menu has exactly one true row — «выбирает CLI» — and says that
   * PartyCo does not know this vendor's list rather than pretending the vendor has none.
   */
  models: readonly ModelChoice[];
  /** Permission modes honoured. Empty ⇒ the rows render blocked, with {@link modesNote} as the why. */
  agentModes: readonly AgentPermission[];
  /** Why this provider honours no mode. Present only when `agentModes` is empty. */
  modesNote?: string;
}

/**
 * The four aliases, ordered from lightest to heaviest — and the order is the information.
 *
 * A menu of model names tells a person nothing about which way is "more". Sorting by the vendor's
 * own ladder does: every step down the list costs more and answers slower, and every step up is
 * faster and cheaper. Anything else is a list the reader has to already know to use.
 *
 * Checked against the vendor's own comparison table rather than remembered, on 2026-07-27:
 *
 * | alias    | resolves to                  | latency  | context | $/MTok in-out |
 * |----------|------------------------------|----------|---------|---------------|
 * | `haiku`  | `claude-haiku-4-5-20251001`  | Fastest  | 200K    | 1 / 5         |
 * | `sonnet` | `claude-sonnet-5`            | Fast     | 1M      | 3 / 15        |
 * | `opus`   | `claude-opus-5`              | Moderate | 1M      | 5 / 25        |
 * | `fable`  | `claude-fable-5`             | Slower   | 1M      | 10 / 50       |
 *
 * The right-hand column is the reason the previous order was wrong: Fable is the *most* expensive
 * and the *slowest*, not a step below Opus. The resolutions are not from the table — each one was
 * read back off the CLI's own `system`/`init` line on this machine, so the aliases are known to
 * point where the documentation says they do.
 *
 * The prices stay out of the menu on purpose. They are true of metered API billing and simply do
 * not describe the delegated-CLI path, where the member is on a flat plan and pays in rate limits
 * rather than dollars — printing «$10 / $50» beside a row would be a precise number about the wrong
 * thing. Relative order is the part that survives both billing models, so relative order is what the
 * notes say.
 */
const ANTHROPIC_MODELS: readonly ModelChoice[] = [
  {
    id: 'haiku',
    label: 'Haiku',
    note: 'Самая быстрая, и почти на уровне старших. Помнит меньше: 200 тысяч токенов против миллиона.',
  },
  {
    id: 'sonnet',
    label: 'Sonnet',
    note: 'Лучшее сочетание скорости и ума — обычный выбор на каждый день.',
  },
  {
    id: 'opus',
    label: 'Opus',
    note: 'Для сложной агентской работы с кодом. С неё вендор советует начинать.',
  },
  {
    id: 'fable',
    label: 'Fable',
    note: 'Максимум возможностей, для долгих автономных задач. Самая медленная и самая дорогая.',
  },
];

export const CAPABILITIES: readonly ProviderCapability[] = [
  {
    providerId: 'anthropic',
    models: ANTHROPIC_MODELS,
    agentModes: ['plan', 'accept-edits', 'auto'],
  },
  {
    providerId: 'openai',
    models: [],
    agentModes: [],
    modesNote:
      'Codex CLI не принимает режим допуска — PartyCo запускает его в песочнице workspace-write. ' +
      'Подменять режим на границы песочницы мы не стали: это разные вещи, и менять чужую песочницу ' +
      'молча нельзя.',
  },
  {
    // Present so the shape of the answer does not depend on which providers happen to be usable.
    // Google's CLI transport is `prohibited` in `policy.ts`, so nothing here is ever reachable —
    // but an absent entry would read as «мы не знаем», and the truth is «нам туда нельзя».
    providerId: 'google',
    models: [],
    agentModes: [],
    modesNote: 'К Gemini CLI из сторонних программ вендор доступ запрещает — PartyCo его не зовёт.',
  },
];

export function findCapability(providerId: string): ProviderCapability | undefined {
  return CAPABILITIES.find((entry) => entry.providerId === providerId);
}
