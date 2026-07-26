import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { EmptyState, type EmptyStateProps, type StateAction } from '../EmptyState/EmptyState.tsx';
import { ErrorState, type ErrorStateProps } from '../ErrorState/ErrorState.tsx';
import {
  LoadingState,
  type LoadingStateColumn,
  type LoadingStateProps,
} from '../LoadingState/LoadingState.tsx';
import { Skeleton } from '../Skeleton/Skeleton.tsx';
import { Rich } from '../Toast/rich.tsx';
import styles from './MergeQueueStates.module.css';

/**
 * The three states screen 2.4 «Merge queue» can be in.
 *
 * `empty` is the odd one out in the whole product: an empty merge queue is not missing data, it is
 * the finished state of the work — everything that was started is in trunk and every lease is
 * released. So it carries no grey «нет данных», no call to action and no muted glyph; it reports
 * the day's numbers and gets out of the way. The designer asked for exactly one empty state in the
 * product that reads as an achievement, and this is it.
 */
export type MergeQueueScreenState = 'empty' | 'loading' | 'error';

/**
 * One number under the empty title.
 *
 * `value` is already formatted («14», «11 с») — this component never does arithmetic and never
 * touches a clock. `tone: 'success'` paints the number with the status colour, which is status role
 * #3 (text); the row draws no fill and no left edge, those belong elsewhere.
 */
export interface MergeQueueMetric {
  value: string;
  label: string;
  tone?: 'neutral' | 'success' | undefined;
}

/**
 * Column tracks of the merge-queue table, expressed off the token scale so the placeholder lands on
 * the real row geometry in both densities: position (16px) · branch · lane chip (44px) · state.
 */
export const MERGE_QUEUE_SKELETON_COLUMNS: readonly LoadingStateColumn[] = [
  { width: 'var(--pc-icon-size)', variant: 'block' },
  { width: '1fr' },
  { width: 'calc(var(--pc-space-32) + var(--pc-space-12))' },
  { width: '1fr' },
];

/** Trunk-health block above the row skeleton (design: 40px square). Scales with density. */
const HEAD_GLYPH_SIZE = 'calc(var(--pc-row-height) + var(--pc-space-12))';
/** The two header lines: a title bar and a thinner meta bar under it. */
const HEAD_TITLE_HEIGHT = 'var(--pc-space-12)';
const HEAD_META_HEIGHT = 'var(--pc-space-8)';

export interface MergeQueueStateCopy {
  empty: EmptyStateProps;
  /** The three numbers under the empty title. Rendered into the `meta` slot of `EmptyState`. */
  emptyMetrics: readonly MergeQueueMetric[];
  loading: LoadingStateProps;
  error: ErrorStateProps;
}

export type MergeQueueStateCopyInput = Partial<MergeQueueStateCopy>;

/**
 * The screen's own words and numbers, in one place. Overridable per instance — the counts are copy,
 * not markup, so a caller with live figures replaces `emptyMetrics` and `error.meta` and nothing in
 * this file has to change.
 */
export const MERGE_QUEUE_STATE_COPY: MergeQueueStateCopy = {
  empty: {
    icon: 'check',
    tone: 'success',
    title: 'Ствол зелёный, очередь пуста',
    description:
      'Всё, что было начато, влито. Leases отпущены, никто никого не ждёт. За сутки 14 влитий и один откат.',
  },
  emptyMetrics: [
    { value: '14', label: 'влито', tone: 'success' },
    { value: '11 с', label: 'медиана fast' },
    { value: '0', label: 'обходов' },
  ],
  loading: {
    rows: 4,
    columns: MERGE_QUEUE_SKELETON_COLUMNS,
    fade: 'ramp',
    caption: 'Читаю очередь и статус гейта · скелет держит геометрию строк',
    label: 'Читаю очередь слияний',
  },
  error: {
    icon: 'incident',
    title: 'Очередь стоит',
    description: (
      <Rich
        value={[
          'Гейт-раннер не отвечает, влития приостановлены. ',
          { text: 'Leases держатся, работа не потеряна', emphasis: 'strong' },
          ' — патчи ждут в очереди в том же порядке.',
        ]}
      />
    ),
    actions: [{ label: 'Проверить раннер' }, { label: 'Диагностика', variant: 'ghost' }],
    meta: 'gate_placement: member · попытка 2 из 8 через 20 с',
  },
};

export interface MergeQueueStatesProps {
  state: MergeQueueScreenState;
  /**
   * Partial override of the default copy — one field or all four. Merged one level deep, so
   * `{ error: { meta } }` replaces only the meta line and leaves the rest of the error state alone.
   */
  copy?: MergeQueueStateCopyInput | undefined;
  onCheckRunner?: (() => void) | undefined;
  onDiagnose?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * Wires handlers onto actions positionally and **drops the ones nobody can perform**: a button that
 * cannot do its job is worse than no button, especially on a screen whose whole message is "nothing
 * is lost". Positional because a `StateAction` is content, not an identifier — the copy may be
 * translated or replaced wholesale and the buttons keep their order.
 */
function wire(
  actions: readonly StateAction[] | undefined,
  handlers: readonly ((() => void) | undefined)[],
): StateAction[] | undefined {
  if (!actions || actions.length === 0) return undefined;
  const wired = actions.flatMap((action, index) => {
    if (action.onClick) return [action];
    const handler = handlers[index];
    return handler ? [{ ...action, onClick: handler }] : [];
  });
  return wired.length > 0 ? wired : undefined;
}

/**
 * The metric row of the empty state: number over caption, thin rules between.
 *
 * Only spans — it goes into the `meta` slot of `EmptyState`, which is a `<span>`, so a `<div>` here
 * would be invalid markup.
 */
function metricRow(metrics: readonly MergeQueueMetric[]): ReactNode {
  if (metrics.length === 0) return null;
  return (
    <span className={styles.metrics}>
      {metrics.map((metric, index) => (
        <Fragment key={metric.label}>
          {index > 0 ? <span className={styles.divider} aria-hidden="true" /> : null}
          <span className={styles.metric}>
            <span
              className={[styles.metricValue, metric.tone === 'success' ? styles.metricSuccess : '']
                .filter(Boolean)
                .join(' ')}
            >
              {metric.value}
            </span>
            <span className={styles.metricLabel}>{metric.label}</span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The three states of screen 2.4 as one props-driven block.
 *
 * Reuses `EmptyState` / `LoadingState` / `ErrorState` verbatim. What this component adds is only
 * what the merge screen has beyond them: the metric row that turns the empty queue into a report of
 * the day, and the trunk-health placeholder that heads the row skeleton so the wait mirrors the real
 * panel instead of stacking grey bricks.
 *
 * The success tile behind the empty glyph is `EmptyState`'s own `tone="success"` — added there
 * rather than rebuilt here, so the next panel that finishes its work gets it for free.
 */
export function MergeQueueStates({
  state,
  copy,
  onCheckRunner,
  onDiagnose,
  className,
}: MergeQueueStatesProps): ReactElement {
  /*
   * Merged one level deep on purpose. A shallow spread turns `copy={{ error: { meta } }}` into a
   * silent wipe of the title, the description and both buttons — it looks like an override of one
   * field and behaves like a replacement of the whole state. That bit once already; a caller who
   * only knows the live retry counter should not have to restate the copy around it.
   */
  const text: MergeQueueStateCopy = copy
    ? {
        ...MERGE_QUEUE_STATE_COPY,
        ...copy,
        empty: { ...MERGE_QUEUE_STATE_COPY.empty, ...copy.empty },
        loading: { ...MERGE_QUEUE_STATE_COPY.loading, ...copy.loading },
        error: { ...MERGE_QUEUE_STATE_COPY.error, ...copy.error },
      }
    : MERGE_QUEUE_STATE_COPY;

  const body = ((): ReactElement => {
    switch (state) {
      case 'empty':
        return (
          <EmptyState
            {...text.empty}
            meta={text.empty.meta ?? metricRow(text.emptyMetrics)}
            className={styles.state ?? ''}
          />
        );

      case 'loading':
        return (
          <>
            <div className={styles.head} aria-hidden="true">
              <Skeleton
                variant="block"
                width={HEAD_GLYPH_SIZE}
                height={HEAD_GLYPH_SIZE}
                radius="lg"
              />
              <span className={styles.headLines}>
                <Skeleton width="58%" height={HEAD_TITLE_HEIGHT} />
                <Skeleton width="80%" height={HEAD_META_HEIGHT} />
              </span>
            </div>
            <LoadingState {...text.loading} className={styles.rows ?? ''} />
          </>
        );

      case 'error': {
        const actions = wire(text.error.actions, [onCheckRunner, onDiagnose]);
        return (
          // `?? []` and not a spread: it has to *override* whatever the copy carried, because an
          // action without a handler is the thing being removed.
          <ErrorState {...text.error} actions={actions ?? []} className={styles.state ?? ''} />
        );
      }
    }
  })();

  return <div className={[styles.root, className ?? ''].filter(Boolean).join(' ')}>{body}</div>;
}
