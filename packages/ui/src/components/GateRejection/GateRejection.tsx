import type { ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { zoneEdgeStyle, type Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Badge } from '../Badge/Badge.tsx';
import { HistoryStrip } from '../HistoryStrip/HistoryStrip.tsx';
import { ResolutionPath } from '../ResolutionPath/ResolutionPath.tsx';
import { Rich } from '../Toast/rich.tsx';
import {
  GATE_REASON_TITLE,
  type GateReasonCode,
  type GateRejectionData,
  type MergeCheck,
} from '../MergeQueueTable/model.ts';
import s from './GateRejection.module.css';

/* ----------------------------------------------------------------- labels */

export interface GateRejectionLabels {
  /** Accessible name of the whole block. Never «отклонён» — see model.ts. */
  region: string;
  /** The muted caption closing the card header, one per reason code. */
  reason: Record<GateReasonCode, string>;
  /** Accessible name of the intervening-writes list. */
  writes: string;
  /** Accessible name of the failed-checks list. */
  checks: string;
  /** Accessible name of the rule-output block. */
  output: string;
  /** Accessible name of the lease-continuity strip. */
  history: string;
  /** Spoken reading of that strip — the dashed gap is exactly what assistive tech cannot see. */
  historyDescription: string;
  /** Per-check navigation. */
  log: string;
  diff: string;
  /** The link that sits next to the footnote. */
  more: string;
}

export type GateRejectionLabelsInput = Partial<Omit<GateRejectionLabels, 'reason'>> & {
  reason?: Partial<Record<GateReasonCode, string>>;
};

/**
 * The block's own words, in one place.
 *
 * `reason` defaults to `GATE_REASON_TITLE` rather than restating it: the wording rule that bans
 * «отклонён» has exactly one home, and copying the three strings here would let them drift.
 */
export const GATE_REJECTION_LABELS: GateRejectionLabels = {
  region: 'Не пропущен гейтом',
  reason: GATE_REASON_TITLE,
  writes: 'Записи в те же пути, пока патч стоял в очереди',
  checks: 'Упавшие проверки',
  output: 'Вывод правила',
  history: 'Непрерывность lease',
  historyDescription:
    'Между началом авторства и отправкой lease прерывался: в истории есть expire и повторный захват.',
  log: 'лог',
  diff: 'дифф',
  more: 'все виды отказов',
};

function mergeLabels(input?: GateRejectionLabelsInput): GateRejectionLabels {
  if (!input) return GATE_REJECTION_LABELS;
  return {
    ...GATE_REJECTION_LABELS,
    ...input,
    reason: { ...GATE_REJECTION_LABELS.reason, ...input.reason },
  };
}

/* ------------------------------------------------------------------ props */

export interface GateRejectionProps {
  /** Everything the block draws. One shape for all three reasons — see model.ts. */
  rejection: GateRejectionData;
  /**
   * `card` is the free-standing block with its own header; `inline` is the disclosure inside a
   * merge-queue row, which already carries the branch, the author and the state.
   */
  variant?: 'card' | 'inline' | undefined;
  /** Whose patch this is. Supplies the card's 2px left edge — identity role #2. */
  author?: Member | undefined;
  /** Branch name in the card header. */
  branch?: string | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Runs a resolution step's button. Without it the steps are a read-only list. */
  onAction?: ((stepId: string) => void) | undefined;
  /** Opens a failed check's log. The link appears only when both this and `logHref` exist. */
  onOpenLog?: ((check: MergeCheck) => void) | undefined;
  /** Opens a failed check's diff. Same rule as the log link. */
  onOpenDiff?: ((check: MergeCheck) => void) | undefined;
  /** «все виды отказов» — drawn only when there is somewhere to go. */
  onMore?: (() => void) | undefined;
  labels?: GateRejectionLabelsInput | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Why the gate did not let a patch through — the loudest state on screen 2.4, and the one that has
 * to stay kind.
 *
 * Three rules hold the tone together:
 *
 * 1. **The mechanism refused, nobody was judged.** The word «отклонён» does not exist in this UI;
 *    the header says «не пропущен гейтом» and the footnote says so again in plain words. The code
 *    chip carries the protocol value verbatim *next to* the human sentence, not instead of it.
 * 2. **The owner does not disappear.** The card's left edge is 2px of the author's identity colour
 *    (role #2) while the rest of the perimeter is a danger outline (status role #4). Danger never
 *    becomes a fill and never takes the left edge — that is the correction the designer accepted.
 * 3. **No raw git, ever.** `output` is the rule's own two lines; there are no conflict markers, no
 *    stack traces and no wall-clock times anywhere in the block.
 *
 * Every section is optional and driven purely by the data: `intervening_write` fills `writes`,
 * `checks_failed` fills `failedChecks` and `output`, `guarded_without_continuous_lease` fills
 * `history`. That is why this is one component and not three.
 */
export function GateRejection({
  rejection,
  variant = 'card',
  author,
  branch,
  identitySet,
  onAction,
  onOpenLog,
  onOpenDiff,
  onMore,
  labels,
  className,
}: GateRejectionProps): ReactElement {
  const t = mergeLabels(labels);
  const { code, subject, explanation, writes, failedChecks, output, history, steps, footnote } =
    rejection;
  const inline = variant === 'inline';

  const body = (
    <>
      {/* The card puts the code chip in its header; inline has no header to put it in. */}
      {inline || subject ? (
        <div className={s.meta}>
          {inline ? (
            <Badge status="danger" mono dot={false}>
              {code}
            </Badge>
          ) : null}
          {subject ? <span className={s.subject}>{subject}</span> : null}
        </div>
      ) : null}

      <p className={s.explanation}>
        <Rich value={explanation} />
      </p>

      {writes && writes.length > 0 ? (
        <ul className={s.list} aria-label={t.writes}>
          {writes.map((write) => (
            <li key={write.id} className={s.row}>
              {/* Identity role #1 — the only place the writer's colour appears here. */}
              <Avatar member={write.author} size="xs" identitySet={identitySet} />
              <span className={s.path}>{write.path}</span>
              <span className={s.rowEnd}>
                {write.added == null ? null : <span className={s.added}>{`+${write.added}`}</span>}
                {write.removed == null ? null : (
                  <span className={s.removed}>{`−${write.removed}`}</span>
                )}
                <span className={s.ago}>{write.ago}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {failedChecks && failedChecks.length > 0 ? (
        <ul className={s.list} aria-label={t.checks}>
          {failedChecks.map((check) => {
            // A link with nowhere to go, or with no navigator to run it, is not drawn at all.
            const canLog = Boolean(check.logHref) && Boolean(onOpenLog);
            const canDiff = Boolean(check.diffHref) && Boolean(onOpenDiff);
            return (
              <li key={check.id} className={s.row}>
                <Icon name="close" className={s.checkGlyph} />
                <span className={s.checkName}>{check.label}</span>
                {check.failure ? <span className={s.checkFailure}>{check.failure}</span> : null}
                {canLog || canDiff ? (
                  <span className={s.rowEnd}>
                    {canLog ? (
                      <button
                        type="button"
                        className={s.link}
                        aria-label={`${t.log}: ${check.label}`}
                        onClick={() => onOpenLog?.(check)}
                      >
                        {t.log}
                      </button>
                    ) : null}
                    {canDiff ? (
                      <button
                        type="button"
                        className={s.link}
                        aria-label={`${t.diff}: ${check.label}`}
                        onClick={() => onOpenDiff?.(check)}
                      >
                        {t.diff}
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {output && output.length > 0 ? (
        <div className={s.output} role="group" aria-label={t.output}>
          {output.map((line, index) => (
            <span key={`${index}-${line}`} className={s.outputLine}>
              {line}
            </span>
          ))}
        </div>
      ) : null}

      {history && history.length > 0 ? (
        <HistoryStrip nodes={history} label={t.history} description={t.historyDescription} />
      ) : null}

      {/* Read-only on purpose: nothing here is a choice between radio options. */}
      {steps.length > 0 ? <ResolutionPath steps={steps} onAction={onAction} /> : null}

      {footnote || onMore ? (
        <div className={s.footer}>
          {footnote ? <span className={s.footnote}>{footnote}</span> : null}
          {onMore ? (
            <button type="button" className={cx(s.link, s.more)} onClick={onMore}>
              {t.more}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (inline) {
    return (
      <div className={cx(s.root, s.inline, className)} role="group" aria-label={t.region}>
        {body}
      </div>
    );
  }

  return (
    <section
      className={cx(s.root, s.card, className)}
      /* Identity role #2 — the author keeps the left edge even in the loudest state. */
      style={author ? zoneEdgeStyle(author.colorSlug, identitySet) : undefined}
      aria-label={t.region}
    >
      <header className={s.header}>
        {author ? <Avatar member={author} size="xs" identitySet={identitySet} /> : null}
        {branch ? <span className={s.branch}>{branch}</span> : null}
        <Badge status="danger" mono dot={false}>
          {code}
        </Badge>
        <span className={s.reason}>{t.reason[code]}</span>
      </header>
      <div className={s.body}>{body}</div>
    </section>
  );
}
