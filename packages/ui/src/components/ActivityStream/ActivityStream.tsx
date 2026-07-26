import { useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import type { Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import styles from './ActivityStream.module.css';

/** Outcome tone of an event. Maps onto the four status tokens, used as text only. */
export type ActivityResultTone = 'neutral' | 'success' | 'warning' | 'danger' | 'running';

export interface ActivityEvent {
  id: string;
  /** Author of the event — resolved against `members`. */
  memberId: string;
  /** Verb, e.g. «записал», «прогнал», «отпустил lease». */
  action: string;
  /** What the action applied to: a path, a branch, a command. Rendered in mono. */
  target?: string | undefined;
  /** Short outcome, e.g. «48 ok». */
  result?: string | undefined;
  resultTone?: ActivityResultTone | undefined;
  /** Already-formatted relative time, e.g. «4с». */
  time: string;
  /** Machine-readable timestamp for the <time> element, when available. */
  datetime?: string | undefined;
}

export interface ActivityStreamProps {
  events: ActivityEvent[];
  /** Everyone who can appear in the feed — the avatar and the filter are built from this. */
  members: Member[];
  title?: string | undefined;
  /** `member` groups the feed under a per-member heading. */
  groupBy?: 'none' | 'member' | undefined;
  showFilter?: boolean | undefined;
  /** Controlled filter: a member id, or null for "everyone". */
  filterMemberId?: string | null | undefined;
  defaultFilterMemberId?: string | null | undefined;
  onFilterChange?: ((memberId: string | null) => void) | undefined;
  identitySet?: IdentitySetName | undefined;
  loading?: boolean | undefined;
  /** Error text. Takes precedence over the feed. */
  error?: ReactNode | undefined;
  onRetry?: (() => void) | undefined;
  allMembersLabel?: string | undefined;
  filterLabel?: string | undefined;
  emptyLabel?: string | undefined;
  retryLabel?: string | undefined;
  /** How many shimmer rows to draw while loading. */
  loadingRows?: number | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function toneClass(tone: ActivityResultTone): string | undefined {
  switch (tone) {
    case 'success':
      return styles.resultSuccess;
    case 'warning':
      return styles.resultWarning;
    case 'danger':
      return styles.resultDanger;
    case 'running':
      return styles.resultRunning;
    case 'neutral':
      return undefined;
  }
}

/**
 * The live feed of what the team just did. One line per event so a whole day scans in seconds;
 * filterable down to a single member and groupable by author when the feed gets busy.
 */
export function ActivityStream({
  events,
  members,
  title = 'Поток активности',
  groupBy = 'none',
  showFilter = true,
  filterMemberId,
  defaultFilterMemberId = null,
  onFilterChange,
  identitySet,
  loading = false,
  error,
  onRetry,
  allMembersLabel = 'по участникам',
  filterLabel = 'Фильтр по участнику',
  emptyLabel = 'Пока ничего не происходило',
  retryLabel = 'Повторить',
  loadingRows = 3,
  className,
}: ActivityStreamProps): ReactElement {
  const selectId = useId();
  const [ownFilter, setOwnFilter] = useState<string | null>(defaultFilterMemberId);
  const controlled = filterMemberId !== undefined;
  const activeFilter = controlled ? filterMemberId : ownFilter;

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const visible = useMemo(
    () => (activeFilter ? events.filter((e) => e.memberId === activeFilter) : events),
    [events, activeFilter],
  );

  const groups = useMemo(() => {
    if (groupBy !== 'member') return null;
    const order: string[] = [];
    const buckets = new Map<string, ActivityEvent[]>();
    for (const event of visible) {
      const bucket = buckets.get(event.memberId);
      if (bucket) {
        bucket.push(event);
      } else {
        buckets.set(event.memberId, [event]);
        order.push(event.memberId);
      }
    }
    return order.map((memberId) => ({
      memberId,
      events: buckets.get(memberId) ?? [],
    }));
  }, [groupBy, visible]);

  function handleFilter(value: string): void {
    const next = value === '' ? null : value;
    if (!controlled) setOwnFilter(next);
    onFilterChange?.(next);
  }

  function renderEvent(event: ActivityEvent, withAvatar: boolean): ReactElement {
    const member = byId.get(event.memberId);
    const tone = event.resultTone ?? 'neutral';
    return (
      <li key={event.id} className={styles.event}>
        {withAvatar && member ? (
          <Avatar member={member} size="xs" identitySet={identitySet} label={member.name} />
        ) : null}
        <span className={styles.action}>{event.action}</span>
        {event.target ? <span className={styles.target}>{event.target}</span> : null}
        {event.result ? (
          <span className={cx(styles.result, toneClass(tone))}>{event.result}</span>
        ) : null}
        {event.datetime ? (
          <time className={styles.time} dateTime={event.datetime}>
            {event.time}
          </time>
        ) : (
          <span className={styles.time}>{event.time}</span>
        )}
      </li>
    );
  }

  let body: ReactNode;
  if (error) {
    body = (
      <div className={styles.error} role="alert">
        <span>{error}</span>
        {onRetry ? (
          <button type="button" className={styles.retry} onClick={onRetry}>
            {retryLabel}
          </button>
        ) : null}
      </div>
    );
  } else if (loading) {
    body = (
      <div aria-busy="true" aria-live="polite">
        {Array.from({ length: Math.max(1, loadingRows) }, (_, i) => (
          <div key={i} className={styles.skeletonRow}>
            <span className={styles.skeletonAvatar} />
            <span className={styles.skeletonLine} />
          </div>
        ))}
      </div>
    );
  } else if (visible.length === 0) {
    body = <p className={styles.empty}>{emptyLabel}</p>;
  } else if (groups) {
    body = (
      <div className={styles.groups}>
        {groups.map((group) => {
          const member = byId.get(group.memberId);
          return (
            <div key={group.memberId}>
              <div className={styles.groupHead}>
                {member ? (
                  <Avatar member={member} size="xs" identitySet={identitySet} decorative />
                ) : null}
                <span>{member?.name ?? group.memberId}</span>
              </div>
              <ul className={styles.list}>
                {group.events.map((event) => renderEvent(event, false))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  } else {
    body = <ul className={styles.list}>{visible.map((event) => renderEvent(event, true))}</ul>;
  }

  return (
    <section className={cx(styles.stream, className)} aria-label={title}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {showFilter ? (
          <span className={styles.filter}>
            <select
              id={selectId}
              className={styles.select}
              value={activeFilter ?? ''}
              onChange={(e) => handleFilter(e.currentTarget.value)}
              aria-label={filterLabel}
            >
              <option value="">{allMembersLabel}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <span className={styles.caret} aria-hidden="true">
              ⌄
            </span>
          </span>
        ) : null}
      </div>
      {body}
    </section>
  );
}
