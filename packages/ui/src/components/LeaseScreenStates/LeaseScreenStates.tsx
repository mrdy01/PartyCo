import type { ReactElement } from 'react';
import { EmptyState, type EmptyStateProps, type StateAction } from '../EmptyState/EmptyState.tsx';
import { ErrorState, type ErrorStateProps } from '../ErrorState/ErrorState.tsx';
import {
  LoadingState,
  type LoadingStateColumn,
  type LoadingStateProps,
} from '../LoadingState/LoadingState.tsx';
import { OwnershipBar } from '../OwnershipBar/OwnershipBar.tsx';
import { Skeleton } from '../Skeleton/Skeleton.tsx';
import { Rich } from '../Toast/rich.tsx';
import styles from './LeaseScreenStates.module.css';

/**
 * The four states screen 2.3 «Leases» can be in.
 *
 * `empty-boundaries` and `empty-holders` are deliberately two different states, not one: the first
 * says the project has never declared what a boundary is, the second says the boundaries are all
 * there and simply nobody is holding one right now. The second is a **normal** state — a team where
 * every lease is released is a team that finished its tasks — so its copy carries no failure tone
 * and no red anywhere.
 */
export type LeaseScreenState = 'empty-boundaries' | 'empty-holders' | 'loading' | 'error';

/**
 * Column tracks of the lease table, expressed off the spacing scale so the skeleton lands on the
 * real geometry in both densities: boundary path · mode badge (18px) · claim (46px) · state.
 */
export const LEASE_TABLE_SKELETON_COLUMNS: readonly LoadingStateColumn[] = [
  { width: '1fr' },
  { width: 'calc(var(--pc-space-16) + var(--pc-space-2))', variant: 'block' },
  { width: 'calc(var(--pc-space-32) + var(--pc-space-12) + var(--pc-space-2))' },
  { width: '1fr' },
];

/** Height of the ownership-map placeholder above the table skeleton (design: 34px). */
const MAP_SKELETON_HEIGHT = 'calc(var(--pc-row-height) + var(--pc-space-6))';

export interface LeaseScreenStateCopy {
  emptyBoundaries: EmptyStateProps;
  emptyHolders: EmptyStateProps;
  /** Mono line under the all-free ownership bar that heads the `empty-holders` state. */
  emptyHoldersSummary: string;
  loading: LoadingStateProps;
  error: ErrorStateProps;
}

export type LeaseScreenStateCopyInput = Partial<LeaseScreenStateCopy>;

/**
 * The screen's own words, in one place. Overridable per instance, but never duplicated: the page,
 * the gallery and the tests all read the same object.
 */
export const LEASE_SCREEN_STATE_COPY: LeaseScreenStateCopy = {
  emptyBoundaries: {
    icon: 'worktree',
    title: 'Границы ещё не объявлены',
    description: (
      <Rich
        value={[
          'Без ',
          { text: '.partyco/architecture.yaml', emphasis: 'code' },
          ' leases брать не на что. Можно вывести черновик из графа зависимостей и подтвердить руками.',
        ]}
      />
    ),
    actions: [{ label: 'Предложить границы' }],
  },
  emptyHolders: {
    icon: 'unlease',
    title: 'Сейчас никто ничего не держит',
    description:
      'Это нормальное состояние, а не ошибка: leases берутся под задачу и отпускаются, когда она уходит в trunk.',
    actions: [{ label: 'Взять границу', hint: 'L' }],
  },
  emptyHoldersSummary: '8 границ · все свободны',
  loading: {
    rows: 4,
    columns: LEASE_TABLE_SKELETON_COLUMNS,
    fade: 'ramp',
    caption: 'Читаю ledger с хаба · 7 leases, 8 границ',
    label: 'Читаю реестр leases',
  },
  error: {
    icon: 'incident',
    title: 'Ledger не читается',
    description: (
      <Rich
        value={[
          'Показаны последние известные leases. ',
          { text: 'Локальная работа продолжается', emphasis: 'strong' },
          ' — твой lease кэширован как ',
          { text: 'AuthorityGrant', emphasis: 'code' },
          ' с TTL, правки идут в твой worktree.',
        ]}
      />
    ),
    actions: [{ label: 'Переподключить' }, { label: 'Диагностика', variant: 'ghost' }],
    meta: 'данные от state_version 81410 · попытка 3 из 8 через 12 с',
  },
};

export interface LeaseScreenStatesProps {
  state: LeaseScreenState;
  /** Partial override of the default copy — one field or all five. */
  copy?: LeaseScreenStateCopyInput | undefined;
  /**
   * Eyebrow of the card header. Supplying it also draws the card frame (and, while loading, the
   * spinner in its top-right corner) — that is the gallery presentation the design sheet shows.
   * Omit it inside a panel that already has a header of its own.
   */
  caption?: string | undefined;
  /** Force the frame on or off independently of `caption`. */
  framed?: boolean | undefined;
  /** How many boundaries exist while nobody holds one. Drives the all-free ownership bar. */
  freeBoundaries?: number | undefined;
  onProposeBoundaries?: (() => void) | undefined;
  onTakeBoundary?: (() => void) | undefined;
  onReconnect?: (() => void) | undefined;
  onDiagnostics?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * Wires handlers onto actions positionally, leaving any `onClick` the copy already carries alone.
 * Positional because a `StateAction` is content, not an identifier — the copy may be translated or
 * replaced wholesale and the buttons still keep their order.
 */
function withHandlers(
  actions: readonly StateAction[] | undefined,
  handlers: readonly ((() => void) | undefined)[],
): StateAction[] | undefined {
  if (!actions || actions.length === 0) return undefined;
  return actions.map((action, index) => {
    const handler = handlers[index];
    return action.onClick || !handler ? action : { ...action, onClick: handler };
  });
}

/**
 * The four states of screen 2.3 as one props-driven block.
 *
 * Reuses `EmptyState` / `LoadingState` / `ErrorState` verbatim — this component only adds what the
 * lease screen has beyond them: the all-free ownership bar above the "nobody holds anything" copy,
 * and the placeholder that mirrors the ownership map plus the table's four columns instead of
 * stacking grey bricks.
 *
 * The error frame is the one place a status colour touches the perimeter, which spec §5 now allows
 * as the fourth status role. Nothing here is filled with status colour.
 */
export function LeaseScreenStates({
  state,
  copy,
  caption,
  framed,
  freeBoundaries = 8,
  onProposeBoundaries,
  onTakeBoundary,
  onReconnect,
  onDiagnostics,
  className,
}: LeaseScreenStatesProps): ReactElement {
  const text: LeaseScreenStateCopy = copy
    ? { ...LEASE_SCREEN_STATE_COPY, ...copy }
    : LEASE_SCREEN_STATE_COPY;
  const withFrame = framed ?? caption !== undefined;

  const body = ((): ReactElement => {
    switch (state) {
      case 'empty-boundaries': {
        const actions = withHandlers(text.emptyBoundaries.actions, [onProposeBoundaries]);
        return (
          <EmptyState
            {...text.emptyBoundaries}
            {...(actions ? { actions } : {})}
            className={styles.state ?? ''}
          />
        );
      }

      case 'empty-holders': {
        const actions = withHandlers(text.emptyHolders.actions, [onTakeBoundary]);
        return (
          <>
            <div className={styles.summary}>
              <OwnershipBar
                shares={[]}
                free={freeBoundaries}
                showLegend={false}
                label={text.emptyHoldersSummary}
              />
              {/* The bar already names itself with this exact line, so it is said once. */}
              <span className={styles.summaryLine} aria-hidden="true">
                {text.emptyHoldersSummary}
              </span>
            </div>
            <EmptyState
              {...text.emptyHolders}
              {...(actions ? { actions } : {})}
              className={styles.state ?? ''}
            />
          </>
        );
      }

      case 'loading':
        return (
          <>
            <div className={styles.mapSkeleton}>
              <Skeleton height={MAP_SKELETON_HEIGHT} radius="sm" />
            </div>
            <LoadingState {...text.loading} className={styles.rows ?? ''} />
          </>
        );

      case 'error': {
        const actions = withHandlers(text.error.actions, [onReconnect, onDiagnostics]);
        return (
          <ErrorState
            {...text.error}
            {...(actions ? { actions } : {})}
            className={styles.state ?? ''}
          />
        );
      }
    }
  })();

  return (
    <section
      className={[
        styles.root,
        withFrame ? styles.framed : '',
        withFrame && state === 'error' ? styles.danger : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={caption}
    >
      {caption !== undefined ? (
        <header className={styles.header}>
          <span className={styles.eyebrow}>{caption}</span>
          {state === 'loading' ? <span className={styles.spinner} aria-hidden="true" /> : null}
        </header>
      ) : null}
      <div className={styles.body}>{body}</div>
    </section>
  );
}
