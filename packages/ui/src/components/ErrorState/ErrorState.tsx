import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import { StateActionButton, type StateAction } from '../EmptyState/EmptyState.tsx';
import styles from './ErrorState.module.css';

export interface ErrorStateProps {
  /** What broke, in the user's terms — not the exception class. */
  title?: string;
  /** What still works, or what happens next. Two lines at most. */
  description?: ReactNode;
  /** Outline glyph above the title. */
  icon?: IconName;
  /**
   * The technical text — endpoint, exit code, stack. Collapsed by default: it must be reachable
   * without a support call, and invisible until asked for.
   */
  detail?: string;
  /** Summary line of the collapsed block. */
  detailLabel?: string;
  /** Expand the detail on mount — for a developer-facing panel where the detail is the point. */
  detailOpen?: boolean;
  /** Retry handler. Omit and no retry button is rendered. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Secondary actions, rendered after retry — a log, a settings screen, a dismissal. */
  actions?: StateAction[];
  /** Small mono line under the actions — attempt counters, next-retry countdown. */
  meta?: ReactNode;
  className?: string;
}

/**
 * Error state for a panel, list or table. Convention §6 makes it mandatory next to `EmptyState` and
 * `LoadingState`.
 *
 * `role="alert"` announces the failure once when the block appears. The glyph is the only element
 * carrying `--pc-status-danger`; the surrounding panel stays neutral — a tinted panel frame is the
 * panel's own decision, not this component's.
 */
export function ErrorState({
  title = 'Не удалось загрузить',
  description,
  icon = 'incident',
  detail,
  detailLabel = 'Подробности',
  detailOpen = false,
  onRetry,
  retryLabel = 'Повторить',
  actions,
  meta,
  className,
}: ErrorStateProps): ReactElement {
  /*
   * Only actions that do something. An error block whose «Переподключить» is decoration is worse
   * than one without it: the reader clicks, nothing changes, and now they distrust the diagnosis
   * too. `StateActionButton` drops handler-less actions on its own; the filter is repeated here so
   * the row does not survive as an empty flex box.
   */
  const allActions: StateAction[] = [
    ...(onRetry ? [{ label: retryLabel, onClick: onRetry }] : []),
    ...(actions ?? []),
  ].filter((action) => action.onClick);

  return (
    <div className={[styles.root, className ?? ''].filter(Boolean).join(' ')} role="alert">
      <Icon name={icon} className={styles.glyph} />
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {allActions.length > 0 ? (
        <div className={styles.actions}>
          {allActions.map((action) => (
            <StateActionButton key={action.label} action={action} />
          ))}
        </div>
      ) : null}
      {meta ? <span className={styles.meta}>{meta}</span> : null}
      {detail ? (
        <details className={styles.details} open={detailOpen}>
          <summary className={styles.summary}>{detailLabel}</summary>
          <pre className={styles.detailBody}>{detail}</pre>
        </details>
      ) : null}
    </div>
  );
}
