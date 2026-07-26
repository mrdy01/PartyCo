import { useState, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, type Member } from '../../identity.ts';
import {
  AgentModeSelector,
  type AgentMode,
} from '../AgentModeSelector/AgentModeSelector.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Badge } from '../Badge/Badge.tsx';
import { Button } from '../Button/Button.tsx';
import type { DiffLine } from '../DiffViewer/DiffViewer.tsx';
import type { StateAction } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { ProviderGlyph } from '../ProviderGlyph/ProviderGlyph.tsx';
import { Skeleton } from '../Skeleton/Skeleton.tsx';
import { formatTokens } from '../StatusBar/StatusBar.tsx';
import { Rich, type RichText } from '../Toast/rich.tsx';
import styles from './AgentSessionPanel.module.css';

/**
 * Architecture §5 — `ScopeEnforcementCoverage`. `mechanical` means the zone limit is enforced by the
 * hub before the tool call lands; `advisory` means the agent was merely *told* about the boundary.
 * The difference is the whole trust story of an autonomous session, so it is shown, never implied.
 */
export type ScopeEnforcementCoverage = 'mechanical' | 'advisory';

export const SCOPE_ENFORCEMENT_LABEL: Record<ScopeEnforcementCoverage, string> = {
  mechanical: 'mechanical',
  advisory: 'advisory',
};

/** Outcome colour of a tool call. Status colour, used as text / pill only. */
export type SessionResultTone = 'neutral' | 'success' | 'warning' | 'danger';

/** Lifecycle of a tool call, as far as the transcript is concerned. */
export type SessionToolState = 'done' | 'failed' | 'running' | 'passed';

export interface SessionToolResult {
  /** Right-aligned outcome, e.g. «чисто», «2 вне зоны», `48/48`. */
  label: string;
  tone?: SessionResultTone | undefined;
  /** Second, always-muted value after the label, e.g. `11.4с`. */
  meta?: string | undefined;
  /** Glyph before the label — `check` for a pass, `close` for a failure. */
  icon?: IconName | undefined;
}

interface TurnBase {
  id: string;
}

/** A human message. The avatar is the only place the author's identity colour appears. */
export interface SessionUserTurn extends TurnBase {
  kind: 'user';
  author: Member;
  text: RichText;
}

/** Collapsible chain of thought: «Рассуждение · 14 строк · 3.2с» plus a muted body. */
export interface SessionReasoningTurn extends TurnBase {
  kind: 'reasoning';
  label?: string | undefined;
  /** Volume and duration, e.g. «14 строк · 3.2с». */
  meta?: string | undefined;
  text: RichText;
  defaultOpen?: boolean | undefined;
}

/** Streamed answer. `streaming` keeps the blinking caret at the end of the last word. */
export interface SessionAssistantTurn extends TurnBase {
  kind: 'assistant';
  text: RichText;
  streaming?: boolean | undefined;
}

/**
 * One tool call, one row of `--pc-row-height`. `state` covers the four rows the design draws:
 * plain (`done`), danger-bordered (`failed`), spinner + progress (`running`) and the green
 * summary row (`passed`).
 */
export interface SessionToolTurn extends TurnBase {
  kind: 'tool';
  /** Tool name in mono: `check_conflicts`, `acquire_lease`, `Read`, `Bash`. */
  name: string;
  /** What the call applied to — a path, a command, a symbol with its call count. */
  target?: string | undefined;
  state?: SessionToolState | undefined;
  result?: SessionToolResult | undefined;
  /** Owner of the zone the call touched. Draws the identity square before the target. */
  zoneOwner?: Member | undefined;
  /** 0…1 for a `running` call. Drives the small progress bar next to the counter. */
  progress?: number | undefined;
}

/** A tool call whose diff is shown inline: the row plus a three-line preview and a footer. */
export interface SessionEditTurn extends TurnBase {
  kind: 'edit';
  /** Tool name. `Edit` unless the caller says otherwise. */
  name?: string | undefined;
  target: string;
  added?: number | undefined;
  removed?: number | undefined;
  /** The preview lines. `DiffLine` is reused verbatim from `DiffViewer`. */
  lines: readonly DiffLine[];
  /** Left side of the footer, e.g. «ещё 39 строк». */
  moreLabel?: string | undefined;
  /** Right side of the footer, e.g. «принято автоматически · обратимо». */
  note?: string | undefined;
  defaultOpen?: boolean | undefined;
}

/** The success-tinted call to action the agent raises when it wants a decision. */
export interface SessionProposalTurn extends TurnBase {
  kind: 'proposal';
  text: RichText;
  actionLabel: string;
  onAction?: (() => void) | undefined;
  actionDisabled?: boolean | undefined;
}

export type SessionTurn =
  | SessionUserTurn
  | SessionReasoningTurn
  | SessionAssistantTurn
  | SessionToolTurn
  | SessionEditTurn
  | SessionProposalTurn;

export interface SessionModel {
  /** Stable provider key — drives the square mark. */
  providerId: string;
  /** Letter stub while the real provider mark is not wired in yet. */
  providerLetter?: string | undefined;
  /** Model id as the user reads it, e.g. `sonnet-4-6`. */
  name: string;
}

export interface SessionContextChip {
  id: string;
  label: string;
  icon?: IconName | undefined;
  /**
   * Identity slug of the member who owns the boundary this chip stands for. Renders the small
   * identity square — identity role #1 (fill), via `avatarStyle`.
   */
  colorSlug?: string | undefined;
}

export interface SessionShortcutHint {
  keys: readonly string[];
  label: string;
}

/** What the panel says when the provider refuses. Design: «Провайдер вернул 429». */
export interface AgentSessionError {
  title?: string | undefined;
  /** Why it happened and what survived — the lease above all. */
  description?: RichText | undefined;
  /** The machine line: `rate_limit · не oauth_org_not_allowed · автоповтор через 18с`. */
  technical?: ReactNode;
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
  onChangeModel?: (() => void) | undefined;
  changeModelLabel?: string | undefined;
}

export interface AgentSessionPanelProps {
  /** Mode the session runs in. Drives the marching top edge and the header tint. */
  mode: AgentMode;
  onModeChange?: ((mode: AgentMode) => void) | undefined;
  /** Modes the current lease set or policy forbids. Shown disabled, never hidden. */
  disabledModes?: readonly AgentMode[] | undefined;

  title?: string | undefined;
  /** Claim this session works under, e.g. `claim c-2288`. */
  claimId?: string | undefined;

  model?: SessionModel | undefined;
  /** Opens the model picker. Without it the chip is inert text. */
  onPickModel?: (() => void) | undefined;
  /** How the scope limit is enforced. Architecture §5. */
  enforcement?: ScopeEnforcementCoverage | undefined;

  /** Tokens spent this session. Formatted with `formatTokens` unless `tokensLabel` is given. */
  tokens?: number | undefined;
  tokensLabel?: string | undefined;
  /** Already-formatted money, e.g. `$0.38`. */
  cost?: string | undefined;

  /** The transcript. Entirely prop-driven — the panel never invents a turn. */
  turns?: readonly SessionTurn[] | undefined;

  /** Composer value. Omit for an uncontrolled box. */
  value?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  placeholder?: string | undefined;
  contextChips?: readonly SessionContextChip[] | undefined;
  shortcuts?: readonly SessionShortcutHint[] | undefined;
  /** Stops the autonomous run. The amber button appears only when handed a callback. */
  onStop?: (() => void) | undefined;
  stopLabel?: string | undefined;

  /** Restoring the transcript from the hub — skeleton in tool-call geometry. */
  loading?: boolean | undefined;
  loadingCaption?: ReactNode;
  /** Non-null replaces the transcript with the failure block. */
  error?: AgentSessionError | null | undefined;

  identitySet?: IdentitySetName | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const DEFAULT_SHORTCUTS: readonly SessionShortcutHint[] = [
  { keys: ['⇧', 'Tab'], label: 'режим' },
  { keys: ['Ctrl', '⇧', 'M'], label: 'модель' },
];

/**
 * The agent session — the loudest surface in the product, because it is the one place where
 * software writes to your repository while you look away.
 *
 * Three signals say "autonomous" at once and none of them can be switched off by data: the 2px
 * marching amber edge across the top, the amber tint under the header, and the pulsing dot on the
 * active allowance bar. The bars themselves are `AgentModeSelector` in its `bars` variant — the
 * variant the designer picked (design notes: «вариант C селектора режима») — so mode geometry lives
 * in one component only.
 */
export function AgentSessionPanel({
  mode,
  onModeChange,
  disabledModes,
  title = 'Сессия · экономика кошелька',
  claimId,
  model,
  onPickModel,
  enforcement = 'mechanical',
  tokens,
  tokensLabel,
  cost,
  turns,
  value,
  onValueChange,
  placeholder = 'Что дальше? Агент работает автономно в границах lease…',
  contextChips,
  shortcuts = DEFAULT_SHORTCUTS,
  onStop,
  stopLabel = 'Остановить агента',
  loading = false,
  loadingCaption = 'Восстанавливаю транскрипт из hub · 340 событий',
  error,
  identitySet,
  label,
  className,
}: AgentSessionPanelProps): ReactElement {
  const [draft, setDraft] = useState('');
  const composerValue = value ?? draft;
  const failed = error !== null && error !== undefined;

  const meter = tokensLabel ?? (tokens === undefined ? undefined : formatTokens(tokens));

  return (
    <section
      className={cx(styles.panel, className)}
      data-mode={mode}
      aria-label={label ?? title}
      aria-busy={loading || undefined}
    >
      <span className={styles.march} aria-hidden="true" />

      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Icon name="agent" className={styles.agentGlyph} />
          <h2 className={styles.title}>{title}</h2>
          {loading ? <span className={styles.headSpinner} aria-hidden="true" /> : null}
          {claimId ? <span className={styles.claim}>{claimId}</span> : null}
        </div>

        <div className={styles.modeWrap}>
          <AgentModeSelector
            variant="bars"
            value={mode}
            className={cx(styles.modeSelector)}
            {...(onModeChange ? { onChange: onModeChange } : {})}
            {...(disabledModes ? { disabledModes } : {})}
          />
        </div>

        <div className={styles.metaRow}>
          {model ? (
            <ModelChip model={model} {...(onPickModel ? { onClick: onPickModel } : {})} />
          ) : null}

          <Badge status="success" mono dot={false} icon="check">
            {SCOPE_ENFORCEMENT_LABEL[enforcement]}
          </Badge>

          {meter || cost ? (
            <span
              className={styles.meter}
              aria-label={`Расход · ${[meter, cost].filter(Boolean).join(' · ')}`}
            >
              {meter ? <span className={styles.meterTokens}>{meter}</span> : null}
              {meter && cost ? <span className={styles.meterDot}>·</span> : null}
              {cost ? <span className={styles.meterCost}>{cost}</span> : null}
            </span>
          ) : null}
        </div>
      </header>

      <div className={styles.body}>
        {failed ? (
          <SessionError error={error} />
        ) : loading ? (
          <TranscriptSkeleton caption={loadingCaption} />
        ) : (
          <ol className={styles.transcript}>
            {(turns ?? []).map((turn) => (
              <li key={turn.id} className={styles.turn} data-kind={turn.kind}>
                <Turn turn={turn} identitySet={identitySet} />
              </li>
            ))}
          </ol>
        )}
      </div>

      <footer className={styles.composer}>
        <div className={styles.inputBox}>
          <textarea
            className={styles.textarea}
            rows={1}
            placeholder={placeholder}
            aria-label={placeholder}
            value={composerValue}
            disabled={loading || failed}
            onChange={(event) => {
              if (value === undefined) setDraft(event.target.value);
              onValueChange?.(event.target.value);
            }}
          />
          {contextChips && contextChips.length > 0 ? (
            <div className={styles.chips}>
              {contextChips.map((chip) => (
                <span key={chip.id} className={styles.chip}>
                  {chip.icon ? <Icon name={chip.icon} className={styles.chipIcon} /> : null}
                  {chip.colorSlug ? (
                    <span
                      className={styles.chipSwatch}
                      style={avatarStyle(chip.colorSlug, identitySet)}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className={styles.chipLabel}>{chip.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.footerRow}>
          {shortcuts.map((hint) => (
            <span key={hint.label} className={styles.hint}>
              <Kbd keys={hint.keys} muted />
              <span className={styles.hintLabel}>{hint.label}</span>
            </span>
          ))}
          {onStop ? (
            <Button variant="warning" size="sm" className={styles.stop} onClick={onStop}>
              {stopLabel}
            </Button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

/* ---------------------------------------------------------------- turns ---- */

function Turn({
  turn,
  identitySet,
}: {
  turn: SessionTurn;
  identitySet: IdentitySetName | undefined;
}): ReactElement {
  switch (turn.kind) {
    case 'user':
      return (
        <div className={styles.userTurn}>
          <Avatar member={turn.author} size="sm" identitySet={identitySet} />
          <p className={styles.userText}>
            <Rich value={turn.text} />
          </p>
        </div>
      );

    case 'reasoning':
      return (
        <details className={styles.reasoning} open={turn.defaultOpen ?? true}>
          <summary className={styles.reasoningSummary}>
            <Icon name="chevron-down" className={styles.twisty} />
            <span className={styles.reasoningLabel}>{turn.label ?? 'Рассуждение'}</span>
            {turn.meta ? <span className={styles.reasoningMeta}>{turn.meta}</span> : null}
          </summary>
          <p className={styles.reasoningBody}>
            <Rich value={turn.text} />
          </p>
        </details>
      );

    case 'assistant':
      return (
        <p className={styles.assistant}>
          <Rich value={turn.text} />
          {turn.streaming ? <span className={styles.caret} aria-hidden="true" /> : null}
        </p>
      );

    case 'tool':
      return <ToolRow turn={turn} identitySet={identitySet} />;

    case 'edit':
      return <EditTurn turn={turn} />;

    case 'proposal':
      return (
        <div className={styles.proposal}>
          <span className={styles.proposalText}>
            <Rich value={turn.text} />
          </span>
          <Button
            variant="primary"
            size="sm"
            className={styles.proposalAction}
            disabled={turn.actionDisabled ?? false}
            {...(turn.onAction ? { onClick: turn.onAction } : {})}
          >
            {turn.actionLabel}
          </Button>
        </div>
      );
  }
}

function ToolRow({
  turn,
  identitySet,
}: {
  turn: SessionToolTurn;
  identitySet: IdentitySetName | undefined;
}): ReactElement {
  const state = turn.state ?? 'done';
  const result = turn.result;
  const percent =
    turn.progress === undefined ? null : Math.max(0, Math.min(100, Math.round(turn.progress * 100)));

  return (
    <div className={styles.toolRow} data-state={state}>
      {state === 'running' ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : state === 'passed' ? (
        <Icon name="check" className={cx(styles.twisty, styles.twistyPass)} />
      ) : (
        // Decorative: the design's twisty marks a call whose output is folded away. It is not a
        // control here — a button that does nothing is worse than a marker that looks like one.
        <Icon name="chevron-right" className={styles.twisty} />
      )}

      <span className={styles.toolName}>{turn.name}</span>

      {turn.zoneOwner ? (
        <Avatar
          member={turn.zoneOwner}
          size="xs"
          identitySet={identitySet}
          label={`Зона · ${turn.zoneOwner.name}`}
        />
      ) : null}

      {turn.target ? <span className={styles.toolTarget}>{turn.target}</span> : null}

      {result || percent !== null ? (
        <span className={styles.toolResult}>
          {percent !== null ? (
            <span
              className={styles.progress}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className={styles.progressFill} style={{ width: `${percent}%` }} />
            </span>
          ) : null}
          {result?.icon ? (
            <Icon name={result.icon} className={styles.resultIcon} data-tone={result.tone ?? 'neutral'} />
          ) : null}
          {result ? (
            <span className={styles.resultLabel} data-tone={result.tone ?? 'neutral'}>
              {result.label}
            </span>
          ) : null}
          {result?.meta ? <span className={styles.resultMeta}>{result.meta}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

function EditTurn({ turn }: { turn: SessionEditTurn }): ReactElement {
  const [open, setOpen] = useState(turn.defaultOpen ?? true);
  const name = turn.name ?? 'Edit';

  return (
    <div className={styles.edit} data-open={open || undefined}>
      <button
        type="button"
        className={styles.editHead}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className={styles.twisty} />
        <span className={styles.editName}>{name}</span>
        <span className={styles.toolTarget}>{turn.target}</span>
        <span className={styles.editCounts}>
          {turn.added === undefined ? null : (
            <span className={styles.countAdd}>{`+${turn.added}`}</span>
          )}
          {turn.removed === undefined ? null : (
            <span className={styles.countDel}>{`−${turn.removed}`}</span>
          )}
        </span>
      </button>

      {open ? (
        <div className={styles.diff}>
          {turn.lines.map((line, index) => {
            const number = line.newNumber ?? line.oldNumber;
            const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
            return (
              <div
                key={`${turn.id}-${number ?? index}-${line.kind}`}
                className={styles.diffLine}
                data-kind={line.kind}
              >
                <span className={styles.diffNo}>{number ?? ''}</span>
                <span className={styles.diffCode}>{`${sign}  ${line.text}`}</span>
              </div>
            );
          })}
          {turn.moreLabel || turn.note ? (
            <div className={styles.diffFoot}>
              {turn.moreLabel ? <span className={styles.diffMore}>{turn.moreLabel}</span> : null}
              {turn.note ? <span className={styles.diffNote}>{turn.note}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- states ---- */

/**
 * The wait mirrors what is coming back: an author line, two tool rows and one edit block, at the
 * exact heights those turns will occupy. Grey bricks of arbitrary size are what makes a transcript
 * jump when the hub answers.
 */
function TranscriptSkeleton({ caption }: { caption: ReactNode }): ReactElement {
  return (
    <div className={styles.skeleton} role="status" aria-label="Загрузка транскрипта">
      <div className={styles.skeletonUser}>
        <Skeleton variant="block" radius="sm" />
        <div className={styles.skeletonLines}>
          <Skeleton />
          <Skeleton width="72%" />
        </div>
      </div>
      <Skeleton height="var(--pc-row-height)" radius="sm" />
      <Skeleton height="var(--pc-row-height)" radius="sm" />
      <Skeleton height="calc(var(--pc-row-height) * 2)" radius="sm" />
      {caption ? <span className={styles.skeletonCaption}>{caption}</span> : null}
    </div>
  );
}

function SessionError({ error }: { error: AgentSessionError }): ReactElement {
  const actions: StateAction[] = error.onChangeModel
    ? [
        {
          label: error.changeModelLabel ?? 'Сменить модель',
          onClick: error.onChangeModel,
          variant: 'ghost',
        },
      ]
    : [];

  return (
    <ErrorState
      className={cx(styles.error)}
      title={error.title ?? 'Провайдер вернул 429'}
      retryLabel={error.retryLabel ?? 'Повторить'}
      {...(error.description === undefined
        ? {}
        : { description: <Rich value={error.description} /> })}
      {...(error.onRetry ? { onRetry: error.onRetry } : {})}
      {...(actions.length > 0 ? { actions } : {})}
      {...(error.technical === undefined || error.technical === null
        ? {}
        : { meta: error.technical })}
    />
  );
}

/* ---------------------------------------------------------------- model ---- */

function ModelChip({
  model,
  onClick,
}: {
  model: SessionModel;
  onClick?: (() => void) | undefined;
}): ReactElement {
  const body = (
    <>
      <ProviderGlyph
        providerId={model.providerId}
        className={styles.modelGlyph}
        {...(model.providerLetter ? { letter: model.providerLetter } : {})}
      />
      <span className={styles.modelName}>{model.name}</span>
      <Icon name="caret-down" className={styles.modelCaret} />
    </>
  );

  if (!onClick) {
    return <span className={styles.modelChip}>{body}</span>;
  }

  return (
    <button
      type="button"
      className={styles.modelChip}
      onClick={onClick}
      aria-label={`Модель сессии · ${model.name}`}
    >
      {body}
    </button>
  );
}
