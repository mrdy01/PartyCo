import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import {
  AGENT_MODE_LABEL,
  isAutonomous,
  type AgentMode,
} from '../AgentModeSelector/AgentModeSelector.tsx';
import styles from './SessionFrame.module.css';

/** State of one tool call inside the session. Drives the right-hand result colour only. */
export type SessionActivityState = 'done' | 'added' | 'failed' | 'running' | 'muted';

export interface SessionActivityItem {
  id: string;
  /** Full line as the agent reports it, e.g. `bash · pnpm test:economy`. */
  label: string;
  /** Right-hand outcome, e.g. `+4 −1`, `2 упали`, `самопочинка`, `идёт`. */
  result?: string;
  state?: SessionActivityState;
  /** Optional glyph from the icon set. Falls back to a neutral marker. */
  icon?: IconName;
}

export interface SessionFrameProps {
  /** Mode this session is running in. Drives the whole framing. */
  mode: AgentMode;
  /** Mono subtitle in the header, e.g. `wallet · sonnet-4-6`. */
  subtitle?: string;
  /** Token / cost meter in the header, e.g. `42.7k · $0.38`. */
  meter?: string;
  /** Overrides the mode name shown in the header. */
  modeLabel?: string;
  /** Tool calls to list above `children`. */
  activity?: readonly SessionActivityItem[];
  /** The streamed body of the session. */
  children?: ReactNode;
  /** Plan mode: the "write is off" notice. Pass `null` to drop it. */
  readOnlyNote?: string | null;
  /** Plan mode: promotes the plan to `accept-edits`. Button appears only when handed a callback. */
  onAcceptPlan?: () => void;
  acceptPlanLabel?: string;
  /** Auto mode: the autonomy strip text. Pass `null` to drop the strip. */
  autonomyNote?: string | null;
  /** Auto mode: stops the autonomous run. Button appears only when handed a callback. */
  onStop?: () => void;
  stopLabel?: string;
  /** Accessible name for the whole frame. */
  label?: string;
  className?: string;
}

/**
 * The session container — "вторая половина решения" from the design: the selector says which mode
 * you picked, the frame says which mode you are *in*, from across the room. Plan gets a cool top
 * edge and a desaturated body; accept-edits stays neutral; auto gets an amber frame, a marching
 * hatch over the top edge and a pulsing dot that never goes away while it is autonomous.
 */
export function SessionFrame({
  mode,
  subtitle,
  meter,
  modeLabel,
  activity,
  children,
  readOnlyNote = 'Запись отключена — агент может только читать и предлагать',
  onAcceptPlan,
  acceptPlanLabel = 'Принять план и перейти в «Приём правок»',
  autonomyNote = 'Работает без подтверждений в границах зоны и политики',
  onStop,
  stopLabel = 'Стоп',
  label,
  className,
}: SessionFrameProps): ReactElement {
  const name = modeLabel ?? AGENT_MODE_LABEL[mode];
  const autonomous = isAutonomous(mode);

  return (
    <section
      className={className ? `${styles.frame} ${className}` : styles.frame}
      data-mode={mode}
      aria-label={label ?? `Сессия · режим «${name}»`}
    >
      <header className={styles.header}>
        <span className={styles.modeName}>
          {autonomous ? <span className={styles.dot} /> : null}
          <span className={styles.modeNameText}>{name}</span>
        </span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
        {meter ? (
          <span className={styles.meter} aria-label={`Расход · ${meter}`}>
            {meter}
          </span>
        ) : null}
      </header>

      <div className={styles.body}>
        {mode === 'plan' && readOnlyNote ? (
          <p className={styles.notice}>
            <Icon name="lease" className={styles.noticeIcon} />
            <span>{readOnlyNote}</span>
          </p>
        ) : null}

        {children}

        {activity && activity.length > 0 ? (
          <ul className={styles.activity}>
            {activity.map((item) => (
              <li key={item.id} className={styles.activityRow}>
                {item.state === 'running' ? (
                  <span className={styles.spinner} aria-hidden="true" />
                ) : item.icon ? (
                  <Icon name={item.icon} className={styles.activityIcon} />
                ) : (
                  <span className={styles.activityMarker} aria-hidden="true">
                    ›
                  </span>
                )}
                <span className={styles.activityLabel}>{item.label}</span>
                {item.result ? (
                  <span className={styles.activityResult} data-state={item.state ?? 'muted'}>
                    {item.result}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {mode === 'plan' && onAcceptPlan ? (
          <button type="button" className={styles.action} onClick={onAcceptPlan}>
            {acceptPlanLabel}
          </button>
        ) : null}

        {autonomous && (autonomyNote || onStop) ? (
          <div className={styles.autonomy}>
            {autonomyNote ? <span>{autonomyNote}</span> : null}
            {onStop ? (
              <button type="button" className={styles.stop} onClick={onStop}>
                {stopLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
