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
  const trunkTone = status.trunk === 'healthy' ? 'success' : 'danger';
  const latency = offline ? undefined : status.latencyLabel;
  const detail = status.detail;

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

      <span className={s.field}>
        <span className={s.dot} data-tone={trunkTone} aria-hidden="true" />
        <span className={s.label}>{SHELL_TRUNK_LABEL[status.trunk]}</span>
      </span>

      {offline && status.offlineNote ? (
        <span className={s.note}>{status.offlineNote}</span>
      ) : (
        <span className={s.field}>
          <span className={s.label}>{text.spendToday}</span>
          <span className={s.spend}>{status.spendLabel}</span>
          <span className={s.figure}>{status.costLabel}</span>
        </span>
      )}

      {/*
       * Always in the tree, hidden when collapsed: `aria-controls` on the button below must point
       * at something that exists, and `hidden` is the honest way to say «есть, но не показано».
       */}
      <span className={s.detail} id={detailId} hidden={!expanded}>
        <span className={s.figure}>
          {text.stateVersion} {detail.stateVersion}
        </span>
        <span className={s.figure}>
          {detail.zoneCount} {text.zoneUnit}
        </span>
        <span className={s.figure}>
          {text.queue} {detail.queueDepth}
        </span>
        <span className={s.figure}>{detail.zoneNote}</span>
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
    </div>
  );
}
