import type { CSSProperties, KeyboardEvent, Ref } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, identityGutterVar, zoneEdgeStyle, type Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import styles from './FileTreeRow.module.css';

/**
 * How a lease is declared over a boundary (docs/architecture.md §5.4). Leases are taken on
 * boundaries — modules — and a file inherits the mode of the boundary it belongs to.
 *
 * `read` — shared read, nobody owns it. `impl` — exclusive implementation. `interface` — exclusive
 * interface, the loudest one, because a contract change ripples. `guarded` — a guarded path that
 * needs an explicit unlock before anything is written to it.
 */
export type LeaseMode = 'read' | 'impl' | 'interface' | 'guarded';

/** The single letter the design puts on the row. Latin on purpose: it is a code, not a word. */
export const LEASE_MODE_BADGE: Record<LeaseMode, string> = {
  read: 'R',
  impl: 'I',
  interface: 'X',
  guarded: 'G',
};

/** Spelled out for assistive tech and the tooltip — the letter alone is unreadable aloud. */
export const LEASE_MODE_LABEL: Record<LeaseMode, string> = {
  read: 'общее чтение',
  impl: 'эксклюзивная реализация',
  interface: 'эксклюзивный интерфейс',
  guarded: 'охраняемый путь',
};

/**
 * One node of the tree, flat. `depth` carries the nesting instead of nested children so that a
 * repo with 40 000 paths can be windowed by a virtualiser without rebuilding a tree.
 */
export interface FileTreeRowData {
  id: string;
  /** What the row shows — usually a segment or a collapsed segment chain («packages/economy»). */
  name: string;
  /** Full path, used by the filter and as the tooltip. */
  path?: string | undefined;
  kind: 'folder' | 'file';
  /** 0 for a top-level node. */
  depth: number;
  /** Folders only. Absent or false means collapsed, and descendants are not rendered. */
  expanded?: boolean | undefined;
  /** `id` of the member holding the lease on this path. */
  ownerId?: string | undefined;
  /** Countdown until the lease expires, e.g. «2m». Rendered as status text. */
  leaseExpiresIn?: string | undefined;
  /** Lines added in the current worktree. */
  added?: number | undefined;
  /** Lines removed in the current worktree. */
  removed?: number | undefined;
  /** Say out loud that nobody holds this path. */
  free?: boolean | undefined;
  /**
   * Muted trailing word where a number would be wrong — «не тронут» for a file that sits inside a
   * lease boundary nobody has written to yet. Stays on neutral text: it is a fact, not a status.
   */
  note?: string | undefined;
  /**
   * Lease mode declared over this path. Boundaries carry it; a file repeats it only when the file
   * itself is special — a guarded path inside an otherwise ordinary boundary.
   */
  leaseMode?: LeaseMode | undefined;
  /** Danger marker instead of the ownership trail, e.g. «инцидент #14». Status colour as text. */
  danger?: string | undefined;
  disabled?: boolean | undefined;
}

export interface FileTreeRowProps {
  row: FileTreeRowData;
  /** The resolved owner of `row.ownerId`. Supplies the zone edge, the tint and the avatar chip. */
  owner?: Member | undefined;
  identitySet?: IdentitySetName | undefined;
  selected?: boolean | undefined;
  /** Roving tabindex, owned by the tree. */
  tabIndex?: number | undefined;
  onSelect?: (() => void) | undefined;
  /** Files: open. Folders use `onToggle` instead. */
  onActivate?: (() => void) | undefined;
  onToggle?: (() => void) | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** Shown when `row.free` is set. */
  freeLabel?: string | undefined;
  /**
   * Draw the owner's avatar chip. `FileTree` turns it off for rows whose visible ancestor already
   * carries the same owner's chip — the zone edge alone answers "still the same zone", exactly as
   * the design draws it. Defaults to on, so a standalone row never hides ownership.
   */
  showOwnerChip?: boolean | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}

/**
 * A tree row. Ownership is readable without hover: 2px identity edge on the left, the owner's
 * tint behind the row, the owner's avatar chip on the right. All three are identity roles; the
 * lease countdown and the diff counters are status *text*, which is allowed.
 */
export function FileTreeRow({
  row,
  owner,
  identitySet,
  selected = false,
  tabIndex,
  onSelect,
  onActivate,
  onToggle,
  onKeyDown,
  freeLabel = 'свободно',
  showOwnerChip = true,
  ref,
}: FileTreeRowProps): React.ReactElement {
  const isFolder = row.kind === 'folder';
  const expanded = isFolder ? row.expanded === true : undefined;
  const emphasised = selected || (isFolder && Boolean(owner)) || row.added != null || row.removed != null;

  const style: CSSProperties = {
    ...zoneEdgeStyle(owner ? owner.colorSlug : null, identitySet),
    ...(owner && !selected
      ? { background: identityGutterVar(owner.colorSlug, identitySet) }
      : null),
  };

  /**
   * An exclusive lease is the owner's claim, so its badge is a filled identity chip — the same role
   * as the avatar, taken through the same helper. `read` and `guarded` belong to nobody and stay on
   * neutral / status colour, which the stylesheet handles.
   */
  const modeStyle: CSSProperties | undefined =
    owner && (row.leaseMode === 'impl' || row.leaseMode === 'interface')
      ? avatarStyle(owner.colorSlug, identitySet)
      : undefined;

  // Indentation is geometry, so it is derived from tokens rather than a magic pixel step.
  const indent: CSSProperties = {
    width: `calc(${Math.max(0, row.depth)} * (var(--pc-icon-size) + var(--pc-row-gap)))`,
  };

  const activate = (): void => {
    if (row.disabled) return;
    onSelect?.();
    if (isFolder) onToggle?.();
    else onActivate?.();
  };

  const className = [
    styles.row,
    selected ? styles.selected : '',
    emphasised ? styles.emphasised : '',
    row.disabled ? styles.disabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={expanded}
      aria-disabled={row.disabled || undefined}
      tabIndex={tabIndex}
      title={row.path ?? row.name}
      className={className}
      style={style}
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      <span className={styles.indent} style={indent} aria-hidden="true" />
      {isFolder ? (
        // One chevron, rotated: `chevron-right` collapsed → `chevron-down` at 90°, which is exactly
        // the pair the design draws, and rotation keeps the open/close motion.
        <Icon
          name="chevron-right"
          className={`${styles.twisty} ${expanded ? styles.twistyOpen : ''}`}
        />
      ) : (
        <span className={styles.twistySpacer} aria-hidden="true" />
      )}
      <Icon name={isFolder ? 'folder' : 'file'} className={styles.glyph} />
      <span className={styles.name}>{row.name}</span>
      {/* Everything after the name is pinned to the right edge, the way the design stacks it. */}
      <span className={styles.trailing}>
        {row.added != null ? <span className={styles.added}>+{row.added}</span> : null}
        {row.removed != null ? <span className={styles.removed}>−{row.removed}</span> : null}
        {row.danger ? (
          <span className={styles.danger}>
            <Icon name="incident" className={styles.dangerGlyph} />
            {row.danger}
          </span>
        ) : null}
        {row.free ? <span className={styles.free}>{freeLabel}</span> : null}
        {row.note ? <span className={styles.note}>{row.note}</span> : null}
        {row.leaseExpiresIn ? <span className={styles.lease}>{row.leaseExpiresIn}</span> : null}
        {row.leaseMode === 'guarded' ? (
          <Icon name="lease" className={styles.lock} />
        ) : null}
        {row.leaseMode ? (
          <span
            className={styles.mode}
            data-mode={row.leaseMode}
            style={modeStyle}
            role="img"
            aria-label={LEASE_MODE_LABEL[row.leaseMode]}
            title={LEASE_MODE_LABEL[row.leaseMode]}
          >
            {LEASE_MODE_BADGE[row.leaseMode]}
          </span>
        ) : null}
        {owner && showOwnerChip ? (
          <Avatar member={owner} size="xs" identitySet={identitySet} />
        ) : null}
      </span>
    </div>
  );
}
