import type { ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Badge } from '../Badge/Badge.tsx';
import { avatarStyle, type Member } from '../../identity.ts';
import type { TrunkHealthData } from '../MergeQueueTable/model.ts';
import s from './TrunkHealth.module.css';

/**
 * The header of screen 2.4 — a verdict about the trunk, not a row in the queue below it.
 *
 * The designer insisted on the distinction and it drives the whole composition: the whole header
 * changes when the trunk goes red (different glyph, different sentence, a person instead of the
 * metrics, no histogram), rather than a cell inside it turning a different colour. `TrunkState` has
 * exactly two values for the same reason — a verdict has no middle.
 *
 * Tone: a red trunk is a state of the system, never an accusation. The words say what happened and
 * who is already on it; they never say «ошибка», «сбой» or «виноват».
 */

/* ------------------------------------------------------------------ model */

/**
 * One merge in the «последние влития» histogram.
 *
 * `height` is 0..1 rather than a count, because the bar states relative size and the component must
 * not invent a scale the caller did not agree to.
 */
export interface TrunkMerge {
  id: string;
  author: Member;
  /** 0..1 — relative size of the merge, already normalised by the caller. */
  height: number;
  /** The one bar the auto-revert took back. Carries a danger outline, never a danger fill. */
  reverted?: boolean | undefined;
  /** Hover title: «lg/deeds-schema». Falls back to the author's name. */
  label?: string | undefined;
}

/**
 * Who is already looking at the red trunk. Present tense on purpose — the header states that the
 * situation is being handled, so nobody else has to start.
 */
export interface TrunkOwner {
  member: Member;
  /** «Лев уже смотрит» */
  headline: string;
  /** Mono line under it: «claim c-2290 вернулся в WORKING · lease сохранён». */
  note: string;
}

/* ----------------------------------------------------------------- labels */

export interface TrunkHealthLabels {
  /** Verdict headline, green trunk. */
  green: string;
  /** Verdict headline, red trunk. Includes the fact that the revert already ran. */
  red: string;
  /** Lead-in of the green sub-line, before the sha. */
  lastGreen: string;
  /** Lead-in of the red sub-line, before the sha. */
  revertedTo: string;
  depth: string;
  drain: string;
  fastLaneP95: string;
  rejectionsToday: string;
  merges: string;
  discussRevert: string;
  rebuilding: string;
}

export type TrunkHealthLabelsInput = Partial<TrunkHealthLabels>;

export const TRUNK_HEALTH_LABELS: TrunkHealthLabels = {
  green: 'Ствол зелёный',
  red: 'Ствол красный · откат выполнен',
  lastGreen: 'последний зелёный',
  revertedTo: 'trunk вернулся на',
  depth: 'В очереди',
  drain: 'Разгребём',
  fastLaneP95: 'Fast lane p95',
  rejectionsToday: 'Отказов сегодня',
  merges: 'Последние влития',
  discussRevert: 'разбор',
  rebuilding: 'trunk снова собирается',
};

/* ------------------------------------------------------------------ props */

export interface TrunkHealthProps {
  data: TrunkHealthData;
  /** The «последние влития» histogram. Omit or pass an empty list and the bars simply do not draw. */
  merges?: readonly TrunkMerge[] | undefined;
  /** Right-aligned counter over the histogram: «14 за сутки · 1 откат». */
  mergesSummary?: string | undefined;
  /** Legend under the histogram: «откачен авто-revert · 3 ч назад». */
  revertNote?: string | undefined;
  /** Supply to draw the «разбор» link. No callback — no link. */
  onDiscussRevert?: (() => void) | undefined;
  /** Red trunk: who is already on it. */
  owner?: TrunkOwner | undefined;
  /** Red trunk: tail of the sub-line after the sha — «сборка снова зелёная · очередь на паузе 40 с». */
  stateNote?: string | undefined;
  /** Red trunk: the success pill «trunk снова собирается», pinned to the right edge. */
  rebuilding?: boolean | undefined;
  identitySet?: IdentitySetName | undefined;
  labels?: TrunkHealthLabelsInput | undefined;
  className?: string | undefined;
}

/* ----------------------------------------------------------------- render */

interface Metric {
  key: string;
  label: string;
  value: string;
  /** Amber when the count is not zero. A count, never a verdict — see the design note. */
  amber?: boolean;
}

/**
 * A merge that happened is a fact, so no bar is ever allowed to disappear: 0 still draws a stub.
 */
function barHeight(height: number): string {
  const clamped = Number.isFinite(height) ? Math.max(0, Math.min(1, height)) : 0;
  return `${Math.round(8 + clamped * 92)}%`;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function TrunkHealth({
  data,
  merges,
  mergesSummary,
  revertNote,
  onDiscussRevert,
  owner,
  stateNote,
  rebuilding = false,
  identitySet,
  labels,
  className,
}: TrunkHealthProps): ReactElement {
  const t = labels ? { ...TRUNK_HEALTH_LABELS, ...labels } : TRUNK_HEALTH_LABELS;
  const red = data.state === 'red';

  const bars = merges ?? [];
  const revertedMerge = bars.find((merge) => merge.reverted);
  const showLegend = revertNote !== undefined || onDiscussRevert !== undefined;
  /* The histogram is a green-trunk instrument: on a red trunk the header is about the revert. */
  const showMerges =
    !red && (bars.length > 0 || mergesSummary !== undefined || showLegend);

  const metrics: Metric[] = [{ key: 'depth', label: t.depth, value: String(data.depth) }];
  if (data.drainEta !== undefined) {
    // Rendered verbatim: model.ts documents the value as already carrying its «~».
    metrics.push({ key: 'drain', label: t.drain, value: data.drainEta });
  }
  if (data.fastLaneP95 !== undefined) {
    metrics.push({ key: 'p95', label: t.fastLaneP95, value: data.fastLaneP95 });
  }
  if (data.rejectionsToday !== undefined) {
    metrics.push({
      key: 'rejections',
      label: t.rejectionsToday,
      value: String(data.rejectionsToday),
      amber: data.rejectionsToday > 0,
    });
  }

  const trailing = red ? (
    owner ? (
      <div className={s.owner}>
        <Avatar member={owner.member} size="md" identitySet={identitySet} decorative />
        <div className={s.ownerText}>
          <span className={s.ownerHeadline}>{owner.headline}</span>
          <span className={s.ownerNote}>{owner.note}</span>
        </div>
      </div>
    ) : null
  ) : (
    <dl className={s.metrics}>
      {metrics.map((metric) => (
        <div key={metric.key} className={s.metric}>
          <dt className={s.eyebrow}>{metric.label}</dt>
          <dd className={s.value} data-tone={metric.amber ? 'warning' : undefined}>
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );

  const barsLabel = [t.merges, mergesSummary, revertNote]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <header className={cx(s.root, className)} data-state={data.state}>
      <div className={s.main}>
        <div className={s.verdict}>
          <span className={s.tile}>
            <Icon name={red ? 'incident' : 'check'} className={s.tileIcon} />
          </span>
          <div className={s.headline}>
            <h2 className={s.title}>{red ? t.red : t.green}</h2>
            {red ? (
              <span className={s.sub}>
                {`${t.revertedTo} `}
                <span className={s.sha}>{data.lastGreenSha}</span>
                {stateNote ? ` · ${stateNote}` : null}
              </span>
            ) : (
              <span className={s.sub}>
                {`${t.lastGreen} `}
                <span className={s.sha}>{data.lastGreenSha}</span>
                {` · ${data.lastGreenAgo}`}
                {data.lastGreenAuthor ? ` · ${data.lastGreenAuthor}` : null}
              </span>
            )}
          </div>
        </div>

        {trailing ? (
          <>
            <span className={s.divider} aria-hidden="true" />
            {trailing}
          </>
        ) : null}

        {red && rebuilding ? (
          <Badge status="success" icon="check" className={s.rebuilding}>
            {t.rebuilding}
          </Badge>
        ) : null}
      </div>

      {showMerges ? (
        <div className={s.merges}>
          <div className={s.mergesHead}>
            <span className={s.eyebrow}>{t.merges}</span>
            {mergesSummary ? <span className={s.mergesSummary}>{mergesSummary}</span> : null}
          </div>

          {bars.length > 0 ? (
            <div className={s.bars} role="img" aria-label={barsLabel}>
              {bars.map((merge) => (
                <span
                  key={merge.id}
                  className={s.bar}
                  data-reverted={merge.reverted ? 'true' : undefined}
                  /* Identity role #1 — the block *is* this member's merge, same statement the
                     avatar makes. The ownership-area tint is invisible on a ~22px bar. */
                  style={{
                    ...avatarStyle(merge.author.colorSlug, identitySet),
                    height: barHeight(merge.height),
                  }}
                  title={merge.label ?? merge.author.name}
                />
              ))}
            </div>
          ) : null}

          {showLegend ? (
            <div className={s.legend}>
              {revertNote ? (
                <span className={s.legendItem}>
                  {revertedMerge ? (
                    <span
                      className={s.swatch}
                      style={avatarStyle(revertedMerge.author.colorSlug, identitySet)}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className={s.legendText}>{revertNote}</span>
                </span>
              ) : null}
              {onDiscussRevert ? (
                <button type="button" className={s.discuss} onClick={onDiscussRevert}>
                  {t.discussRevert}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
