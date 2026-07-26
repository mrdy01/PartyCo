import type { ReactElement } from 'react';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import styles from './PendingDecisions.module.css';

export interface PendingDecision {
  id: string;
  /** What the decision is about, e.g. `Селектор режима`. */
  topic: string;
  /** What happens by default if the human stays silent, e.g. `C — полосы допуска`. */
  choice: string;
  /** Trailing qualification, e.g. `если не скажешь иначе`. */
  note?: string;
  /** `blocking` — work is stopped until this is answered. */
  severity?: 'default' | 'blocking';
  /** Who is waiting, e.g. `merge queue` or `ivan`. */
  waitingOn?: string;
}

export interface PendingDecisionsProps {
  items: readonly PendingDecision[];
  /** Panel heading. */
  title?: string;
  /** Confirms the default. Buttons appear only when a handler is supplied. */
  onAccept?: (id: string) => void;
  /** Opens the decision for editing. */
  onChange?: (id: string) => void;
  acceptLabel?: string;
  changeLabel?: string;
  /** Loading skeleton instead of the list. */
  loading?: boolean;
  /** Error message instead of the list. */
  error?: string | null;
  /** Retry action for the error state. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Second line of the error state — what still holds while the list is unavailable. */
  errorDescription?: string;
  emptyLabel?: string;
  /** Second line of the empty state. */
  emptyDescription?: string;
  loadingLabel?: string;
  className?: string;
}

/**
 * The queue of things awaiting the user's word. Deliberately not a modal stack: decisions are
 * listed with the default the system will take on silence, so the honest reading is "ничего не
 * сломается, но выбор за тобой".
 */
export function PendingDecisions({
  items,
  title = 'Решения, которые ждут твоего слова',
  onAccept,
  onChange,
  acceptLabel = 'Согласен',
  changeLabel = 'Изменить',
  loading = false,
  error = null,
  onRetry,
  retryLabel = 'Повторить',
  errorDescription = 'Решения живут в журнале хаба — ни одно не потеряно, пока список недоступен.',
  emptyLabel = 'Ничего не ждёт твоего слова',
  emptyDescription = 'Агенты работают по уже согласованным правилам.',
  loadingLabel = 'Загружаю решения…',
  className,
}: PendingDecisionsProps): ReactElement {
  const blocking = items.filter((item) => item.severity === 'blocking').length;

  return (
    <section
      className={className ? `${styles.panel} ${className}` : styles.panel}
      aria-label={title}
    >
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {!loading && !error && items.length > 0 ? (
          <span
            className={styles.count}
            data-blocking={blocking > 0 || undefined}
            aria-label={`Ждут решения: ${items.length}`}
          >
            {items.length}
          </span>
        ) : null}
      </header>

      {loading ? (
        <LoadingState rows={3} withMeta label={loadingLabel} />
      ) : error ? (
        <ErrorState
          title={error}
          description={errorDescription}
          retryLabel={retryLabel}
          {...(onRetry ? { onRetry } : {})}
        />
      ) : items.length === 0 ? (
        <EmptyState title={emptyLabel} description={emptyDescription} icon="check" />
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li
              key={item.id}
              className={styles.item}
              data-severity={item.severity ?? 'default'}
            >
              <span className={styles.text}>
                {item.severity === 'blocking' ? (
                  <span
                    className={styles.blockingDot}
                    role="img"
                    aria-label="Работа остановлена"
                  />
                ) : null}
                <span className={styles.topic}>{item.topic}:</span>{' '}
                <span className={styles.choice}>{item.choice}</span>
                {item.note ? <span className={styles.note}>, {item.note}</span> : null}
              </span>
              {item.waitingOn ? (
                <span className={styles.waiting}>{item.waitingOn}</span>
              ) : null}
              {onAccept || onChange ? (
                <span className={styles.actions}>
                  {onChange ? (
                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => onChange(item.id)}
                      aria-label={`${changeLabel} · ${item.topic}`}
                    >
                      {changeLabel}
                    </button>
                  ) : null}
                  {onAccept ? (
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => onAccept(item.id)}
                      aria-label={`${acceptLabel} · ${item.topic}`}
                    >
                      {acceptLabel}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
