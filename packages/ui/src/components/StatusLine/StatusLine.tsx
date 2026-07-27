import { useId, type ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import {
  SHELL_CONNECTION_LABEL,
  SHELL_CONNECTION_TONE,
  SHELL_TRUNK_LABEL,
  type ShellStatus,
} from '../AppShell/model.ts';
import s from './StatusLine.module.css';

export interface StatusLineLabels {
  /** Accessible name of the whole line. */
  line: string;
  /** Opens the spend field. Today's spend, not the session's — a session number compares to nothing. */
  spendToday: string;
  details: string;
  /** Caption before `stateVersion`. A protocol field name, hence not translated. */
  stateVersion: string;
  /**
   * Unit after the zone count. Latin `lease` on purpose: this is the hidden technical row, the one
   * place `ZONE_TERM_HINT` survives for people who read the documents.
   */
  zoneUnit: string;
  queue: string;
}

export const STATUS_LINE_LABELS: StatusLineLabels = {
  line: 'Состояние',
  spendToday: 'Сегодня',
  details: 'Подробности',
  stateVersion: 'state_version',
  zoneUnit: 'lease',
  queue: 'очередь',
};

export interface StatusLineProps {
  status: ShellStatus;
  /** Whether the four hidden fields are showing. Controlled — the line keeps no state of its own. */
  expanded?: boolean | undefined;
  onToggleDetails?: (() => void) | undefined;
  labels?: Partial<StatusLineLabels> | undefined;
  className?: string | undefined;
}

/** Field-by-field, so an explicit `undefined` in a partial override cannot erase a default. */
function mergeLabels(labels: Partial<StatusLineLabels> | undefined): StatusLineLabels {
  if (!labels) return STATUS_LINE_LABELS;
  return {
    line: labels.line ?? STATUS_LINE_LABELS.line,
    spendToday: labels.spendToday ?? STATUS_LINE_LABELS.spendToday,
    details: labels.details ?? STATUS_LINE_LABELS.details,
    stateVersion: labels.stateVersion ?? STATUS_LINE_LABELS.stateVersion,
    zoneUnit: labels.zoneUnit ?? STATUS_LINE_LABELS.zoneUnit,
    queue: labels.queue ?? STATUS_LINE_LABELS.queue,
  };
}

/**
 * The one status line: connection, trunk, spend — and nothing else until asked.
 *
 * The owner's own hypothesis was that only those three must be visible always; the other four
 * (`state_version`, held zones, queue depth, the note about my own zone) are facts a person needs
 * occasionally and never needs to watch, so they live behind «Подробности». They are not deleted:
 * a counter you cannot find when you want it is worse than one you never look at.
 *
 * Offline is the one state that changes the line's composition rather than its colour: the spend
 * field gives way to the only thing that actually changed — zones stop being handed out. The line's
 * top hairline goes red with it. Status colour as dot, text and edging only; never as a fill.
 *
 * `StatusBar` is not forked and not replaced — the three original screens still show every field
 * at once, which is the right answer for a screen an operator watches.
 */
export function StatusLine({
  status,
  expanded = false,
  onToggleDetails,
  labels,
  className,
}: StatusLineProps): ReactElement {
  const text = mergeLabels(labels);
  const detailId = useId();

  const offline = status.connection === 'offline';
  const connectionTone = SHELL_CONNECTION_TONE[status.connection];
  const trunk = status.trunk;
  const latency = offline ? undefined : status.latencyLabel;
  const detail = status.detail;

  // Both halves or neither: «Сегодня 12.4k» without the money, or the money without the tokens, is
  // a field that raises a question instead of answering one.
  const spend =
    status.spendLabel !== undefined && status.costLabel !== undefined
      ? { tokens: status.spendLabel, cost: status.costLabel }
      : undefined;

  const details = [
    detail?.stateVersion !== undefined
      ? { key: 'stateVersion', text: `${text.stateVersion} ${detail.stateVersion}` }
      : undefined,
    detail?.zoneCount !== undefined
      ? { key: 'zoneCount', text: `${detail.zoneCount} ${text.zoneUnit}` }
      : undefined,
    detail?.queueDepth !== undefined
      ? { key: 'queueDepth', text: `${text.queue} ${detail.queueDepth}` }
      : undefined,
    detail?.zoneNote !== undefined ? { key: 'zoneNote', text: detail.zoneNote } : undefined,
  ].filter((field): field is { key: string; text: string } => field !== undefined);

  return (
    <div
      className={className ? `${s.line} ${className}` : s.line}
      data-connection={status.connection}
      role="group"
      aria-label={text.line}
    >
      <span className={s.field}>
        <span
          className={s.dot}
          data-tone={connectionTone}
          data-pulse={status.connection === 'relay' ? 'true' : undefined}
          aria-hidden="true"
        />
        <span className={s.connectionLabel}>{SHELL_CONNECTION_LABEL[status.connection]}</span>
        {latency ? <span className={s.figure}>{latency}</span> : null}
      </span>

      {trunk ? (
        <span className={s.field}>
          <span
            className={s.dot}
            data-tone={trunk === 'healthy' ? 'success' : 'danger'}
            aria-hidden="true"
          />
          <span className={s.label}>{SHELL_TRUNK_LABEL[trunk]}</span>
        </span>
      ) : null}

      {offline && status.offlineNote ? (
        <span className={s.note}>{status.offlineNote}</span>
      ) : spend ? (
        <span className={s.field}>
          <span className={s.label}>{text.spendToday}</span>
          <span className={s.spend}>{spend.tokens}</span>
          <span className={s.figure}>{spend.cost}</span>
        </span>
      ) : null}

      {/*
       * Always in the tree, hidden when collapsed: `aria-controls` on the button below must point
       * at something that exists, and `hidden` is the honest way to say «есть, но не показано».
       *
       * With nothing behind it the disclosure disappears entirely rather than opening onto an empty
       * row — the same rule the file tree applies to its header buttons.
       */}
      {details.length > 0 ? (
        <>
          <span className={s.detail} id={detailId} hidden={!expanded}>
            {details.map((field) => (
              <span key={field.key} className={s.figure}>
                {field.text}
              </span>
            ))}
          </span>

          <button
            type="button"
            className={s.details}
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={onToggleDetails}
          >
            <span className={s.detailsLabel}>{text.details}</span>
            <Icon name="chevron-down" className={s.chevron} strokeWidth={1.6} />
          </button>
        </>
      ) : null}
    </div>
  );
}
