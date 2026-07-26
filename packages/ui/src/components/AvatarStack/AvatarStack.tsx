import type { ReactElement, ReactNode } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import type { Member } from '../../identity.ts';
import { Avatar, AvatarCount, type AvatarSize } from '../Avatar/Avatar.tsx';
import styles from './AvatarStack.module.css';

export interface AvatarStackProps {
  members: Member[];
  /** How many avatars to show before collapsing the rest into the "+N" chip. */
  max?: number | undefined;
  size?: AvatarSize | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Presence dot on every avatar. On by default — the stack is the live head count. */
  showStatus?: boolean | undefined;
  /** Head count line to the right. Set false to render avatars only. */
  showSummary?: boolean | undefined;
  /** Total project members. Defaults to `members.length`. */
  total?: number | undefined;
  /** Members online now. Defaults to everyone whose status is not `offline`. */
  onlineCount?: number | undefined;
  /** Replaces the generated head count entirely. */
  summary?: ReactNode | undefined;
  totalLabel?: string | undefined;
  onlineLabel?: string | undefined;
  overflowLabel?: string | undefined;
  emptyLabel?: string | undefined;
  onMemberClick?: ((member: Member) => void) | undefined;
  onOverflowClick?: (() => void) | undefined;
  className?: string | undefined;
  /** Accessible name for the whole group. */
  label?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The project head count at a glance: who is here, who is busy, how many are hidden.
 * Identity colour appears only as the avatar fill; the live state is a dot, never a fill.
 */
export function AvatarStack({
  members,
  max = 4,
  size = 'md',
  identitySet,
  showStatus = true,
  showSummary = true,
  total,
  onlineCount,
  summary,
  totalLabel = 'в проекте',
  onlineLabel = 'онлайн',
  overflowLabel = 'Ещё',
  emptyLabel = 'Никого нет в проекте',
  onMemberClick,
  onOverflowClick,
  className,
  label = 'Участники проекта',
}: AvatarStackProps): ReactElement {
  const visible = max > 0 ? members.slice(0, max) : members;
  const hidden = max > 0 ? members.slice(max) : [];
  const totalCount = total ?? members.length;
  const online = onlineCount ?? members.filter((m) => (m.status ?? 'idle') !== 'offline').length;

  const summaryNode: ReactNode =
    summary ?? `${totalCount} ${totalLabel} · ${online} ${onlineLabel}`;

  if (members.length === 0) {
    return (
      <div className={cx(styles.stack, className)}>
        <span className={styles.empty}>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className={cx(styles.stack, className)}>
      <div className={styles.avatars} role="group" aria-label={label}>
        {visible.map((member) => (
          <Avatar
            key={member.id}
            member={member}
            size={size}
            identitySet={identitySet}
            showStatus={showStatus}
            ring
            onClick={onMemberClick}
          />
        ))}
        {hidden.length > 0 ? (
          <AvatarCount
            count={hidden.length}
            size={size}
            ring
            label={`${overflowLabel} ${hidden.length}: ${hidden.map((m) => m.name).join(', ')}`}
            onClick={onOverflowClick}
          />
        ) : null}
      </div>
      {showSummary ? <span className={styles.summary}>{summaryNode}</span> : null}
    </div>
  );
}
