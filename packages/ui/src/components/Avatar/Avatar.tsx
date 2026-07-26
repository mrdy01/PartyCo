import type { CSSProperties, ReactElement } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import {
  MEMBER_STATUS_LABEL,
  avatarStyle,
  initialsOf,
  memberStatusColor,
  type Member,
  type MemberStatus,
} from '../../identity.ts';
import styles from './Avatar.module.css';

/**
 * xs — the 14px in-row / activity-feed glyph.
 * sm — the presence-row avatar.
 * md — the standalone / stacked avatar.
 */
export type AvatarSize = 'xs' | 'sm' | 'md';

export interface AvatarProps {
  member: Member;
  size?: AvatarSize | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Presence dot in the bottom-right corner. */
  showStatus?: boolean | undefined;
  /** Overrides `member.status` for the dot. */
  status?: MemberStatus | undefined;
  /** Pulse the dot. Defaults to true for live statuses (thinking / editing / running-tests). */
  pulse?: boolean | undefined;
  /** 2px surface-coloured ring — required when avatars overlap. */
  ring?: boolean | undefined;
  /** Hide from assistive tech, e.g. when the member name sits next to the avatar as real text. */
  decorative?: boolean | undefined;
  /** Accessible name. Defaults to the member name (plus the status, when the dot is shown). */
  label?: string | undefined;
  onClick?: ((member: Member) => void) | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

const LIVE_STATUSES: readonly MemberStatus[] = ['thinking', 'editing', 'running-tests'];

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function sizeClass(size: AvatarSize): string | undefined {
  if (size === 'xs') return styles.xs;
  if (size === 'sm') return styles.sm;
  return styles.md;
}

/**
 * Identity role #1 — the avatar fill. The colour is the only thing that comes from data rather
 * than from the theme, which is why it is the one inline style allowed here (see CONVENTIONS §2).
 */
export function Avatar({
  member,
  size = 'md',
  identitySet,
  showStatus = false,
  status,
  pulse,
  ring = false,
  decorative = false,
  label,
  onClick,
  className,
  style,
}: AvatarProps): ReactElement {
  const effectiveStatus: MemberStatus = status ?? member.status ?? 'idle';
  const initials = initialsOf(member);
  const fill = avatarStyle(member.colorSlug, identitySet);
  const name = label ?? member.name;
  const accessibleName = showStatus ? `${name} · ${MEMBER_STATUS_LABEL[effectiveStatus]}` : name;
  const live = pulse ?? LIVE_STATUSES.includes(effectiveStatus);

  const dot = showStatus ? (
    <span
      className={cx(
        styles.dot,
        effectiveStatus === 'offline' && styles.dotHollow,
        live && styles.dotLive,
      )}
      style={{ color: memberStatusColor(effectiveStatus) }}
      aria-hidden="true"
    />
  ) : null;

  const body = (
    <>
      <span className={styles.initials} aria-hidden="true">
        {initials}
      </span>
      {dot}
    </>
  );

  const classes = cx(styles.avatar, sizeClass(size), ring && styles.ring, className);
  const inline: CSSProperties = style ? { ...fill, ...style } : fill;

  if (onClick) {
    return (
      <button
        type="button"
        className={cx(classes, styles.button)}
        style={inline}
        onClick={() => onClick(member)}
        aria-label={accessibleName}
        title={accessibleName}
      >
        {body}
      </button>
    );
  }

  if (decorative) {
    return (
      <span className={classes} style={inline} aria-hidden="true">
        {body}
      </span>
    );
  }

  return (
    <span className={classes} style={inline} role="img" aria-label={accessibleName} title={accessibleName}>
      {body}
    </span>
  );
}

export interface AvatarCountProps {
  /** How many members are hidden behind the chip. */
  count: number;
  size?: AvatarSize | undefined;
  ring?: boolean | undefined;
  /** Accessible name, e.g. «Ещё 2: Лев Гринберг, Оля Нечаева». */
  label?: string | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * The "+N" chip that closes an {@link AvatarStack}. Neutral by design: it stands for several
 * people at once, so it must not borrow anybody's identity colour.
 */
export function AvatarCount({
  count,
  size = 'md',
  ring = false,
  label,
  onClick,
  className,
}: AvatarCountProps): ReactElement {
  const text = `+${count}`;
  const classes = cx(styles.count, sizeClass(size), ring && styles.ring, className);

  if (onClick) {
    return (
      <button
        type="button"
        className={cx(classes, styles.countButton)}
        onClick={onClick}
        aria-label={label ?? text}
        title={label ?? text}
      >
        {text}
      </button>
    );
  }

  return (
    <span className={classes} role="img" aria-label={label ?? text} title={label ?? text}>
      {text}
    </span>
  );
}
