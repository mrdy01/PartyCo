import type { ReactElement } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import {
  MEMBER_STATUS_LABEL,
  memberStatusColor,
  type Member,
  type MemberStatus,
} from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import styles from './PresenceRow.module.css';

export interface PresenceRowProps {
  member: Member;
  /** Overrides `member.status`. */
  status?: MemberStatus | undefined;
  /** Overrides the default label from MEMBER_STATUS_LABEL, e.g. «пишет код». */
  statusLabel?: string | undefined;
  /** Appended after a middle dot, e.g. «#2», «2ч». */
  statusDetail?: string | undefined;
  /** Pulse the status dot. Defaults to true for live statuses. */
  pulse?: boolean | undefined;
  /** One-letter provider chip. Defaults to the first letter of `member.providerId`. */
  providerGlyph?: string | undefined;
  /** Model currently in use, e.g. «sonnet-4-6». Absent → the placeholder is shown. */
  modelName?: string | undefined;
  /** Shown instead of the model when nothing is running. */
  modelPlaceholder?: string | undefined;
  /** Marker appended to the local user's name. */
  selfLabel?: string | undefined;
  selected?: boolean | undefined;
  identitySet?: IdentitySetName | undefined;
  onSelect?: ((member: Member) => void) | undefined;
  className?: string | undefined;
}

const LIVE_STATUSES: readonly MemberStatus[] = ['thinking', 'editing', 'running-tests'];

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * A single presence line. Reads left to right as: who · what they are doing right now · on what
 * model. Status colour is confined to the dot and its label; the avatar carries the identity.
 */
export function PresenceRow({
  member,
  status,
  statusLabel,
  statusDetail,
  pulse,
  providerGlyph,
  modelName,
  modelPlaceholder = '—',
  selfLabel = '(вы)',
  selected = false,
  identitySet,
  onSelect,
  className,
}: PresenceRowProps): ReactElement {
  const effectiveStatus: MemberStatus = status ?? member.status ?? 'idle';
  const offline = effectiveStatus === 'offline';
  const live = pulse ?? LIVE_STATUSES.includes(effectiveStatus);
  const label = statusLabel ?? MEMBER_STATUS_LABEL[effectiveStatus];
  const text = statusDetail ? `${label} · ${statusDetail}` : label;
  const glyph = providerGlyph ?? member.providerId?.slice(0, 1) ?? '';

  const content = (
    <>
      <Avatar member={member} size="sm" identitySet={identitySet} decorative />
      <span className={styles.name}>
        {member.name}
        {member.isSelf ? <span className={styles.self}>{selfLabel}</span> : null}
      </span>
      <span className={styles.status} style={{ color: memberStatusColor(effectiveStatus) }}>
        <span
          className={cx(styles.dot, offline && styles.dotHollow, live && styles.dotLive)}
          aria-hidden="true"
        />
        <span className={styles.statusText}>{text}</span>
      </span>
      {modelName ? (
        <span className={styles.model}>
          {glyph ? (
            <span className={styles.glyph} aria-hidden="true">
              {glyph}
            </span>
          ) : null}
          <span className={styles.modelName}>{modelName}</span>
        </span>
      ) : (
        <span className={styles.modelEmpty} aria-hidden="true">
          {modelPlaceholder}
        </span>
      )}
    </>
  );

  const classes = cx(
    styles.row,
    selected && styles.selected,
    offline && styles.offline,
    className,
  );

  if (onSelect) {
    return (
      <button
        type="button"
        className={cx(classes, styles.interactive)}
        onClick={() => onSelect(member)}
        aria-pressed={selected}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={classes} aria-current={selected ? 'true' : undefined}>
      {content}
    </div>
  );
}
