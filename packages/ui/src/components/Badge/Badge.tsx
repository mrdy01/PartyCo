import type { HTMLAttributes, ReactNode } from 'react';
import type { StatusName } from '@partyco/tokens';
import { Icon, type IconName } from '@partyco/icons';
import styles from './Badge.module.css';

/**
 * A badge carries one of the four status semantics, or none at all (`neutral`) — the outlined
 * counter chip in the design (`#2`). Spec §01 limits status colour to dot / pill / text, and a
 * badge is exactly the "pill + text (+ dot)" case, so it is the only place all three appear at once.
 */
export type BadgeStatus = StatusName | 'neutral';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Status semantics driving pill tint, dot and text colour. `neutral` renders the outlined chip. */
  status?: BadgeStatus | undefined;
  /** Label. Russian in the UI — the badge never invents its own text. */
  children: ReactNode;
  /** Leading dot. On by default for every status except `neutral`. */
  dot?: boolean | undefined;
  /** Pulse the dot for a live, still-running signal. Defaults to on for `running`. */
  pulse?: boolean | undefined;
  /** Render the label in the mono face — counters, identifiers, `#2`. */
  mono?: boolean | undefined;
  /**
   * Leading glyph instead of (or alongside) the dot. Used where the badge states a *verified* fact
   * rather than a live status — `check` + `mechanical` for a mechanically enforced scope limit.
   * Inherits the badge's status colour through `currentColor`.
   */
  icon?: IconName | undefined;
}

export function Badge({
  status = 'neutral',
  children,
  dot,
  pulse,
  mono = false,
  icon,
  className,
  ...rest
}: BadgeProps): React.ReactElement {
  // An explicit glyph already carries the semantics; the dot would only add noise unless asked for.
  const showDot = dot ?? (icon === undefined && status !== 'neutral');
  const shouldPulse = pulse ?? status === 'running';

  return (
    <span
      className={className ? `${styles.badge} ${className}` : styles.badge}
      data-status={status}
      data-mono={mono ? 'true' : undefined}
      {...rest}
    >
      {icon ? <Icon name={icon} className={styles.glyph} /> : null}
      {showDot ? (
        <span className={styles.dot} data-pulse={shouldPulse ? 'true' : undefined} aria-hidden="true" />
      ) : null}
      <span className={styles.label}>{children}</span>
    </span>
  );
}
