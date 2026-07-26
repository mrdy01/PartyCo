import { useId, type ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import type { WorkStep } from '../AppShell/model.ts';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import styles from './WorkSummary.module.css';

/**
 * `wide` — the 640px conversation column (export lines 595–602).
 * `narrow` — the 560px pane of screen 04 (lines 790–799): shorter bar, raised fill, no diff link.
 */
export type WorkSummaryVariant = 'wide' | 'narrow';

/** State of the expanded step list — it is a list, so §6 applies to it as much as to a panel. */
export type WorkStepsState = 'ready' | 'loading' | 'error';

export interface WorkSummaryCopy {
  /** Tooltip on the handle. The visible summary is the accessible name. */
  toggleHint: string;
  /** Read after the figure: «19 строк добавлено». */
  added: string;
  removed: string;
  /** Group label of the expanded list. */
  steps: string;
  /** The row expanded and the agent recorded no steps. */
  empty: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
}

export const WORK_SUMMARY_COPY: WorkSummaryCopy = {
  toggleHint: 'Показать, что делал агент',
  added: 'строк добавлено',
  removed: 'строк удалено',
  steps: 'Что делал агент',
  empty: 'Шагов не записано — полный ход остался в панели сессии.',
  loading: 'Собираем шаги',
  errorTitle: 'Не получилось показать шаги',
  errorBody: 'Работа агента на месте — не показался только список. Это просмотр, ничего не потеряно.',
  retry: 'Попробовать снова',
};

export interface WorkSummaryProps {
  /** «Правил 2 файла, прочитал 4». */
  summary: string;
  added: number;
  removed: number;
  /** Trailing link, e.g. «посмотреть дифф». Absent when there is nothing to open. */
  diffLabel?: string | undefined;
  steps?: readonly WorkStep[] | undefined;
  expanded?: boolean | undefined;
  /** Omit and the row is a static chip: no chevron affordance, no `aria-expanded`. */
  onToggle?: (() => void) | undefined;
  /** Called by the «посмотреть дифф» button, which sits next to the handle — never inside it. */
  onOpenDiff?: (() => void) | undefined;
  stepsState?: WorkStepsState | undefined;
  onRetrySteps?: (() => void) | undefined;
  variant?: WorkSummaryVariant | undefined;
  copy?: Partial<WorkSummaryCopy> | undefined;
  /** Base for the `aria-controls` id. Defaults to a generated one. */
  id?: string | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The agent's session collapsed to one line — the handle that opens `AgentSessionPanel`, not a
 * replacement for it. Reasoning, tool calls, modes and enforcement coverage all still live there;
 * what a person needs in the ribbon is «правил столько-то, вот сколько строк, вот дифф».
 *
 * Two controls, deliberately siblings: the whole bar toggles the step list, and «посмотреть дифф»
 * opens the diff. Nesting the second inside the first would be invalid HTML and would make the
 * link unreachable from the keyboard as a separate action.
 */
export function WorkSummary({
  summary,
  added,
  removed,
  diffLabel,
  steps,
  expanded = false,
  onToggle,
  onOpenDiff,
  stepsState = 'ready',
  onRetrySteps,
  variant = 'wide',
  copy,
  id,
  className,
}: WorkSummaryProps): ReactElement {
  const text: WorkSummaryCopy = copy ? { ...WORK_SUMMARY_COPY, ...copy } : WORK_SUMMARY_COPY;
  const generatedId = useId();
  const panelId = `${id ?? generatedId}-steps`;
  const interactive = Boolean(onToggle);

  const handleBody = (
    <>
      <Icon name="chevron-right" className={styles.chevron} />
      <span className={styles.summary}>{summary}</span>
      {added > 0 ? (
        <span className={styles.added} title={`${added} ${text.added}`}>
          {`+${added}`}
        </span>
      ) : null}
      {removed > 0 ? (
        <span className={styles.removed} title={`${removed} ${text.removed}`}>
          {`−${removed}`}
        </span>
      ) : null}
    </>
  );

  const stepList = steps ?? [];

  return (
    <div
      className={cx(styles.root, className)}
      data-variant={variant}
      data-expanded={expanded ? 'true' : undefined}
      data-interactive={interactive ? 'true' : undefined}
    >
      <div className={styles.bar}>
        {interactive ? (
          <button
            type="button"
            className={styles.handle}
            aria-expanded={expanded}
            aria-controls={panelId}
            title={text.toggleHint}
            onClick={onToggle}
          >
            {handleBody}
          </button>
        ) : (
          <span className={styles.handle} data-static="true">
            {handleBody}
          </span>
        )}
        {diffLabel ? (
          <>
            <span className={styles.divider} aria-hidden="true" />
            <button type="button" className={styles.diff} onClick={onOpenDiff}>
              {diffLabel}
            </button>
          </>
        ) : null}
      </div>

      {expanded ? (
        <div id={panelId} className={styles.steps} role="group" aria-label={text.steps}>
          {stepsState === 'loading' ? (
            <LoadingState rows={2} withGlyph={false} withMeta={false} label={text.loading} />
          ) : null}
          {stepsState === 'error' ? (
            <ErrorState
              title={text.errorTitle}
              description={text.errorBody}
              {...(onRetrySteps ? { onRetry: onRetrySteps, retryLabel: text.retry } : {})}
            />
          ) : null}
          {stepsState === 'ready' && stepList.length === 0 ? (
            <p className={styles.stepsEmpty}>{text.empty}</p>
          ) : null}
          {stepsState === 'ready' && stepList.length > 0 ? (
            <ul className={styles.stepList}>
              {stepList.map((step, index) => (
                <li key={`${step.file}-${index}`} className={styles.step}>
                  <span className={styles.stepFile}>{step.file}</span>
                  <span className={styles.stepSep} aria-hidden="true">
                    {'·'}
                  </span>
                  <span className={styles.stepNote}>{step.note}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
