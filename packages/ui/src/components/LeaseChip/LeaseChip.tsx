import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, initialsOf, type Member } from '../../identity.ts';
import styles from './LeaseChip.module.css';

/**
 * How loud the chip is allowed to be. Derived from the TTL unless overridden:
 * `calm` → neutral chip, `warning` → warning tint + border (the state shown in the design),
 * `critical` → danger tint + border, for the last seconds before the lease drops.
 */
export type LeaseUrgency = 'calm' | 'warning' | 'critical';

/** Default escalation thresholds, in milliseconds. */
export const LEASE_WARN_BELOW_MS = 5 * 60_000;
export const LEASE_CRITICAL_BELOW_MS = 60_000;

/**
 * `12m`, `2m 40s`, `45s`, `1h 20m` — the mono TTL format the design uses. Kept exported so a
 * caller that formats elsewhere (a table cell, a tooltip) stays consistent with the chip.
 */
export function formatLeaseRemaining(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

export interface LeaseChipProps {
  /** Path pattern the lease covers, e.g. `packages/economy/**`. */
  path: string;
  /** Lease holder. Supplies identity role #1 (avatar fill) and the initials — nothing else. */
  owner: Member;
  /** Milliseconds left on the TTL. Zero or less renders the expired state. */
  remainingMs: number;
  /** Escalate to the warning look at or below this many ms. */
  warnBelowMs?: number | undefined;
  /** Escalate to the critical look at or below this many ms. */
  criticalBelowMs?: number | undefined;
  /** Pin the urgency instead of deriving it from `remainingMs`. */
  urgency?: LeaseUrgency | undefined;
  /** Identity palette the project uses. */
  identitySet?: IdentitySetName | undefined;
  /** Override the TTL formatter. */
  formatRemaining?: ((ms: number) => string) | undefined;
  /** Makes the chip a button — click to focus or release the lease. */
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  leaseLabel?: string | undefined;
  ownerLabel?: string | undefined;
  remainingLabel?: string | undefined;
  expiredLabel?: string | undefined;
  className?: string | undefined;
}

function resolveUrgency(
  remainingMs: number,
  warnBelowMs: number,
  criticalBelowMs: number,
): LeaseUrgency {
  if (remainingMs <= criticalBelowMs) return 'critical';
  if (remainingMs <= warnBelowMs) return 'warning';
  return 'calm';
}

/**
 * Lease chip — who holds which path, and how long they still hold it. The TTL is the product's
 * core "act now" signal, so it escalates on its own: neutral while there is time, warning tint
 * under five minutes, danger tint under a minute, and an explicit «Истекла» once it runs out.
 */
export function LeaseChip({
  path,
  owner,
  remainingMs,
  warnBelowMs = LEASE_WARN_BELOW_MS,
  criticalBelowMs = LEASE_CRITICAL_BELOW_MS,
  urgency,
  identitySet,
  formatRemaining = formatLeaseRemaining,
  onClick,
  disabled = false,
  leaseLabel = 'Lease',
  ownerLabel = 'Владелец',
  remainingLabel = 'Осталось',
  expiredLabel = 'Истекла',
  className,
}: LeaseChipProps): React.ReactElement {
  const expired = remainingMs <= 0;
  const level = urgency ?? resolveUrgency(remainingMs, warnBelowMs, criticalBelowMs);
  const ttlText = expired ? expiredLabel : formatRemaining(remainingMs);
  const ttlTitle = expired ? expiredLabel : `${remainingLabel}: ${ttlText}`;
  const fullLabel = `${leaseLabel} ${path} · ${ownerLabel}: ${owner.name} · ${ttlTitle}`;

  const rootClassName = className ? `${styles.chip} ${className}` : styles.chip;

  const body = (
    <>
      <span
        className={styles.avatar}
        style={avatarStyle(owner.colorSlug, identitySet)}
        role="img"
        aria-label={`${ownerLabel}: ${owner.name}`}
      >
        {initialsOf(owner)}
      </span>
      <span className={styles.path}>{path}</span>
      <span className={styles.ttl} title={ttlTitle}>
        {ttlText}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={rootClassName}
        data-urgency={level}
        data-expired={expired ? 'true' : undefined}
        onClick={onClick}
        disabled={disabled}
        aria-label={fullLabel}
      >
        {body}
      </button>
    );
  }

  return (
    <span
      className={rootClassName}
      data-urgency={level}
      data-expired={expired ? 'true' : undefined}
      title={fullLabel}
    >
      {body}
    </span>
  );
}
