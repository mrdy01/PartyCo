import type { ReactElement } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { Icon, type IconName } from '@partyco/icons';
import { Avatar } from '../Avatar/Avatar.tsx';
import type { Member } from '../../identity.ts';
import s from './NavRail.module.css';

/**
 * `dot` — something needs attention but the count is not the point (unread tasks).
 * `count` — the number itself is the signal (merge-queue depth).
 */
export interface NavRailBadge {
  kind: 'dot' | 'count';
  /** Required for `count`; ignored for `dot`. */
  value?: number | undefined;
  /** Appended to the item's accessible name, e.g. «есть новое». Defaults per kind. */
  label?: string | undefined;
}

export interface NavRailItem {
  id: string;
  icon: IconName;
  /** Visible nowhere — the rail is icon-only — so this IS the accessible name. Russian. */
  label: string;
  badge?: NavRailBadge | undefined;
}

/** Health of the link to the hub. Status colour, dot role only. */
export type NavRailConnectionHealth = 'ok' | 'degraded' | 'down' | 'unknown';

export interface NavRailProps {
  items: readonly NavRailItem[];
  /** Id of the section currently open. */
  activeId?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  /** 1–2 characters for the project square at the top, e.g. «Х». */
  projectInitial: string;
  /** Accessible name of the project square. */
  projectLabel?: string | undefined;
  onProjectClick?: (() => void) | undefined;
  connectionHealth?: NavRailConnectionHealth | undefined;
  /** Spoken/hover text for the health dot, e.g. «LAN · 8 мс». */
  connectionLabel?: string | undefined;
  /** The local user, shown at the very bottom with a status dot. */
  user?: Member | undefined;
  identitySet?: IdentitySetName | undefined;
  onUserClick?: ((member: Member) => void) | undefined;
  /** Accessible name of the `<nav>`. */
  label?: string | undefined;
  className?: string | undefined;
}

const BADGE_LABEL: Record<NavRailBadge['kind'], string> = {
  dot: 'есть новое',
  count: 'в очереди',
};

const CONNECTION_LABEL: Record<NavRailConnectionHealth, string> = {
  ok: 'Связь в норме',
  degraded: 'Связь нестабильна',
  down: 'Связь потеряна',
  unknown: 'Связь проверяется',
};

function accessibleName(item: NavRailItem): string {
  const badge = item.badge;
  if (!badge) return item.label;
  if (badge.kind === 'count') {
    if (typeof badge.value !== 'number') return item.label;
    return `${item.label} · ${badge.label ?? BADGE_LABEL.count} ${badge.value}`;
  }
  return `${item.label} · ${badge.label ?? BADGE_LABEL.dot}`;
}

/**
 * The 52px navigation rail: project square, the icon-only sections, and — pinned to the bottom —
 * connection health and the local user.
 *
 * Every item is a real `<button>` inside a real `<nav>`, and because nothing here carries visible
 * text, each one gets both `aria-label` and `title`: the first for assistive tech, the second so a
 * sighted user can hover and find out what the glyph means.
 */
export function NavRail({
  items,
  activeId,
  onSelect,
  projectInitial,
  projectLabel = 'Проект',
  onProjectClick,
  connectionHealth,
  connectionLabel,
  user,
  identitySet,
  onUserClick,
  label = 'Разделы проекта',
  className,
}: NavRailProps): ReactElement {
  const healthName = connectionHealth
    ? `${connectionLabel ?? CONNECTION_LABEL[connectionHealth]}`
    : undefined;

  return (
    <div className={className ? `${s.rail} ${className}` : s.rail}>
      <button
        type="button"
        className={s.project}
        onClick={onProjectClick}
        aria-label={projectLabel}
        title={projectLabel}
      >
        <span className={s.projectInitial} aria-hidden="true">
          {projectInitial}
        </span>
      </button>

      <nav className={s.nav} aria-label={label}>
        <ul className={s.list}>
          {items.map((item) => {
            const active = item.id === activeId;
            const name = accessibleName(item);
            return (
              <li key={item.id} className={s.listItem}>
                <button
                  type="button"
                  className={s.item}
                  data-active={active || undefined}
                  {...(active ? { 'aria-current': 'page' as const } : {})}
                  onClick={() => onSelect?.(item.id)}
                  aria-label={name}
                  title={name}
                >
                  <Icon name={item.icon} className={s.icon} />
                  <ItemBadge badge={item.badge} />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={s.foot}>
        {connectionHealth && healthName ? (
          <span
            className={s.health}
            data-health={connectionHealth}
            role="img"
            aria-label={healthName}
            title={healthName}
          />
        ) : null}
        {user ? (
          <Avatar
            member={user}
            size="md"
            showStatus
            className={s.avatar}
            {...(identitySet ? { identitySet } : {})}
            {...(onUserClick ? { onClick: onUserClick } : {})}
          />
        ) : null}
      </div>
    </div>
  );
}

function ItemBadge({ badge }: { badge: NavRailBadge | undefined }): ReactElement | null {
  if (!badge) return null;
  if (badge.kind === 'dot') return <span className={s.dot} aria-hidden="true" />;
  if (typeof badge.value !== 'number') return null;
  return (
    <span className={s.count} aria-hidden="true">
      {badge.value}
    </span>
  );
}
