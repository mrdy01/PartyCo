import type { ReactElement } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { Skeleton } from '../Skeleton/Skeleton.tsx';
import {
  MERGE_CHECK_STATE_LABEL,
  checkProgress,
  type MergeCheck,
  type MergeCheckState,
} from '../MergeQueueTable/model.ts';
import styles from './LaneDiagram.module.css';

/**
 * The two check lanes of screen 2.4, drawn as two rails.
 *
 * The panel exists to make one distinction impossible to miss: **fast lane is the only synchronous
 * path into trunk** — cheap checks, seconds, and the patch is not merged until they are green —
 * while **full lane runs after the merge**, asynchronously, with an auto-revert window as its
 * safety net. A list of check names cannot say that; two rails with different lengths, different
 * medians and a dashed window at the end of the second one can.
 *
 * The rail line runs *behind* the chips (`z-index`, opaque chip background) rather than between
 * them, because a check is a station on the path, not a step in a list — the path exists whether or
 * not anything is standing on it, which is exactly what an empty lane has to show.
 */

/* ------------------------------------------------------------------- tones */

/** Chip tone. Status colour as outline / glyph / small text — roles §5 allows, never as a fill. */
export type LaneChipTone = 'success' | 'warning' | 'danger' | 'running' | 'neutral';

/**
 * Tone of a check chip.
 *
 * `note` is a **refusal counter**, not a state: the design paints `guarded continuity` as a normal
 * chip with an amber outline and «1 отказ» next to the name — the check itself is fine, it is the
 * gate that turned somebody away. Folding that into `state: 'failed'` would make the chip claim the
 * check is broken, so the note gets its own tone and leaves the state alone.
 */
export function checkTone(check: MergeCheck): LaneChipTone {
  if (check.state === 'failed') return 'danger';
  if (check.note) return 'warning';
  if (check.state === 'running') return 'running';
  if (check.state === 'passed') return 'success';
  return 'neutral';
}

/** The glyph a chip carries when nothing overrides it. `null` — a bare pip, no glyph. */
const CHECK_GLYPH: Record<MergeCheckState, IconName | null> = {
  passed: 'check',
  failed: 'close',
  running: null,
  pending: null,
  skipped: null,
};

/**
 * Marker glyphs are drawn at ~10px, far below the 16px grid the set was designed on, so they get a
 * heavier stroke — see the note on `IconProps.strokeWidth`.
 */
const GLYPH_STROKE = 1.7;

/* ------------------------------------------------------------------ labels */

export interface LaneDiagramLabels {
  /** Accessible name of the whole block. */
  region: string;
  /** A rail with nothing on it — the lane exists, no check is declared for it. */
  emptyChecks: string;
  /** No lanes at all. */
  emptyTitle: string;
  emptyHint: string;
  /** Announced once while the composition of the lanes is still unknown. */
  loading: string;
  errorTitle: string;
  errorRetry: string;
  /** Spoken state of a chip — the outline and the glyph say it silently. */
  checkState: Record<MergeCheckState, string>;
}

export type LaneDiagramLabelsInput = Partial<Omit<LaneDiagramLabels, 'checkState'>> & {
  checkState?: Partial<Record<MergeCheckState, string>>;
};

export const LANE_DIAGRAM_LABELS: LaneDiagramLabels = {
  region: 'Полосы проверок',
  emptyChecks: 'проверок нет',
  emptyTitle: 'Полосы не объявлены',
  emptyHint: 'Гейт ещё не сказал, какие проверки он гоняет и в какой полосе.',
  loading: 'Читаю состав проверок',
  errorTitle: 'Состав проверок не пришёл',
  errorRetry: 'Повторить',
  checkState: MERGE_CHECK_STATE_LABEL,
};

function mergeLabels(input?: LaneDiagramLabelsInput | undefined): LaneDiagramLabels {
  if (!input) return LANE_DIAGRAM_LABELS;
  return {
    ...LANE_DIAGRAM_LABELS,
    ...input,
    checkState: { ...LANE_DIAGRAM_LABELS.checkState, ...input.checkState },
  };
}

/* ------------------------------------------------------------------- model */

/**
 * The tail of a rail that is not a check — full lane ends with «окно авто-revert 20 м», which is a
 * property of the lane rather than something that passes or fails. Kept out of `checks` on purpose:
 * a window with a state would be a lie.
 */
export interface LaneTrailing {
  icon?: IconName | undefined;
  label: string;
}

export interface LaneSpec {
  id: 'fast' | 'full';
  /** «Fast lane» — painted uppercase, in the lane's own colour. */
  title: string;
  /** «дешёвые проверки · единственный синхронный путь в trunk · секунды» */
  hint: string;
  /** «медиана 11 с». Relative by construction — never a clock time. */
  median?: string | undefined;
  checks: readonly MergeCheck[];
  trailing?: LaneTrailing | undefined;
}

export interface LaneDiagramProps {
  lanes: readonly LaneSpec[];
  /** Composition of the lanes is still being read. Draws the rails at their real geometry. */
  loading?: boolean | undefined;
  /** Non-empty message switches the panel into its error state. */
  error?: string | undefined;
  /** Retry from the error state. Omit and no retry button is drawn. */
  onRetry?: (() => void) | undefined;
  /**
   * Per-check glyph override, keyed by `MergeCheck.id`.
   *
   * The model has no icon field — a check is a program, not a picture — but the design does give
   * `guarded continuity` the `lease` glyph, because that check *is* the lease guard. Rather than
   * guess a glyph from the check's name, the caller states it. Without an entry the chip falls back
   * to its state glyph.
   */
  checkIcons?: Readonly<Record<string, IconName>> | undefined;
  labels?: LaneDiagramLabelsInput | undefined;
  className?: string | undefined;
}

/* -------------------------------------------------------------------- chip */

function CheckChip({
  check,
  icon,
  labels,
}: {
  check: MergeCheck;
  /** Not optional: `exactOptionalPropertyTypes` forbids passing an explicit undefined. */
  icon: IconName | undefined;
  labels: LaneDiagramLabels;
}): ReactElement {
  const tone = checkTone(check);
  // Both the bar and the counter come from the same call, so «96/312» and the fill can never drift.
  const progress = check.state === 'running' ? checkProgress(check) : null;
  const glyph = icon ?? CHECK_GLYPH[check.state];

  return (
    <li className={styles.chip} data-tone={tone} data-state={check.state}>
      {check.state === 'running' ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : glyph ? (
        <Icon name={glyph} strokeWidth={GLYPH_STROKE} className={styles.glyph} />
      ) : (
        <span className={styles.pip} aria-hidden="true" />
      )}
      <span className={styles.chipLabel}>{check.label}</span>
      {progress ? (
        <>
          {/* Hidden from AT: the counter right next to it says the same thing in words. */}
          <span className={styles.bar} aria-hidden="true">
            <span className={styles.barFill} style={{ width: `${progress.pct}%` }} />
          </span>
          <span className={styles.progress}>{progress.label}</span>
        </>
      ) : null}
      {check.note ? <span className={styles.note}>{check.note}</span> : null}
      <span className={styles.srOnly}>{labels.checkState[check.state]}</span>
    </li>
  );
}

/* -------------------------------------------------------------------- lane */

function LaneRail({
  lane,
  labels,
  checkIcons,
}: {
  lane: LaneSpec;
  labels: LaneDiagramLabels;
  checkIcons: Readonly<Record<string, IconName>> | undefined;
}): ReactElement {
  const bare = lane.checks.length === 0 && !lane.trailing;

  return (
    <div
      className={styles.lane}
      data-lane={lane.id}
      role="group"
      aria-label={`${lane.title} — ${lane.hint}`}
    >
      <div className={styles.head}>
        <span className={styles.title}>{lane.title}</span>
        <span className={styles.hint}>{lane.hint}</span>
        {lane.median ? <span className={styles.median}>{lane.median}</span> : null}
      </div>
      <div className={styles.rail}>
        <span className={styles.line} aria-hidden="true" />
        {bare ? (
          <span className={styles.bare}>{labels.emptyChecks}</span>
        ) : (
          <ol className={styles.chips}>
            {lane.checks.map((check) => (
              <CheckChip
                key={check.id}
                check={check}
                icon={checkIcons?.[check.id]}
                labels={labels}
              />
            ))}
            {lane.trailing ? (
              <li className={styles.chip} data-kind="window" data-tone="neutral">
                {lane.trailing.icon ? (
                  <Icon
                    name={lane.trailing.icon}
                    strokeWidth={GLYPH_STROKE}
                    className={styles.glyph}
                  />
                ) : null}
                <span className={styles.chipLabel}>{lane.trailing.label}</span>
              </li>
            ) : null}
          </ol>
        )}
      </div>
    </div>
  );
}

/**
 * Skeleton widths of one rail, as a share of its width. Chosen so the first slot lands flush left
 * and the last flush right — the same geometry the real chips take, so nothing jumps when the data
 * arrives.
 */
const SKELETON_CHIPS: readonly string[] = ['22%', '18%', '20%', '16%'];

function LaneRailSkeleton({ lane }: { lane: LaneSpec | null }): ReactElement {
  return (
    <div className={styles.lane} data-lane={lane?.id ?? 'fast'}>
      <div className={styles.head}>
        {lane ? (
          <>
            <span className={styles.title}>{lane.title}</span>
            <span className={styles.hint}>{lane.hint}</span>
            {lane.median ? <span className={styles.median}>{lane.median}</span> : null}
          </>
        ) : (
          <>
            <Skeleton width="18%" />
            <Skeleton width="34%" />
          </>
        )}
      </div>
      <div className={styles.rail}>
        <span className={styles.line} aria-hidden="true" />
        <div className={styles.chips}>
          {SKELETON_CHIPS.map((width) => (
            <Skeleton key={width} width={width} className={styles.chipSkeleton ?? ''} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- panel */

export function LaneDiagram({
  lanes,
  loading = false,
  error,
  onRetry,
  checkIcons,
  labels: labelsInput,
  className,
}: LaneDiagramProps): ReactElement {
  const labels = mergeLabels(labelsInput);

  const body = ((): ReactElement => {
    if (error) {
      return (
        <ErrorState
          icon="incident"
          title={labels.errorTitle}
          description={error}
          retryLabel={labels.errorRetry}
          {...(onRetry ? { onRetry } : {})}
          className={styles.state ?? ''}
        />
      );
    }

    if (loading) {
      // Two rails even when nothing is known yet: this screen always has exactly fast and full, so
      // the placeholder states geometry, not content — no invented lane names.
      const slots: readonly (LaneSpec | null)[] = lanes.length > 0 ? lanes : [null, null];
      return (
        <>
          {slots.map((lane, index) => (
            <LaneRailSkeleton key={lane ? lane.id : index} lane={lane} />
          ))}
          <span className={styles.srOnly} role="status">
            {labels.loading}
          </span>
        </>
      );
    }

    if (lanes.length === 0) {
      return (
        <EmptyState
          icon="merge"
          title={labels.emptyTitle}
          description={labels.emptyHint}
          className={styles.state ?? ''}
        />
      );
    }

    return (
      <>
        {lanes.map((lane) => (
          <LaneRail key={lane.id} lane={lane} labels={labels} checkIcons={checkIcons} />
        ))}
      </>
    );
  })();

  return (
    <section
      className={[styles.root, className ?? ''].filter(Boolean).join(' ')}
      aria-label={labels.region}
      aria-busy={loading || undefined}
    >
      {body}
    </section>
  );
}
