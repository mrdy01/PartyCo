import { useCallback, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import type { Member } from '../../identity.ts';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
// `FileTreeRowData` lives with the row component and is exported from there only — one owner per
// type, so the package barrel cannot end up with two named re-exports of it.
import { FileTreeRow, type FileTreeRowData } from '../FileTreeRow/FileTreeRow.tsx';
import styles from './FileTree.module.css';

export interface FileTreeLabels {
  /** Placeholder of the filter field. */
  filterPlaceholder: string;
  /** Accessible name of the filter field. */
  filterLabel: string;
  /** Nothing matches the filter / the repo is empty. */
  empty: string;
  loading: string;
  /** Suffix on a path nobody holds. */
  free: string;
  /**
   * Singular / few / many forms of the lease counter. Kept as a triple even though `lease`
   * no longer inflects, because the tree is also used in locales that do inflect — the term is
   * Latin, the counter around it is not.
   */
  leaseForms: readonly [string, string, string];
  /** Accessible name of the tree itself. */
  tree: string;
}

const DEFAULT_LABELS: FileTreeLabels = {
  filterPlaceholder: 'Фильтр по пути',
  filterLabel: 'Фильтр по пути',
  empty: 'Ничего не найдено',
  loading: 'Загружаем дерево…',
  free: 'свободно',
  leaseForms: ['lease', 'leases', 'leases'],
  tree: 'Дерево файлов',
};

export interface FileTreeProps {
  /** Flat, in display order, each row carrying its own `depth`. */
  rows: readonly FileTreeRowData[];
  /** Everyone who might hold a lease; used to resolve `row.ownerId`. */
  members?: readonly Member[] | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Repo / project name in the header. */
  projectName: string;
  /** Worktree the tree is showing, e.g. «wt/ivan». */
  worktree?: string | undefined;
  /** How many leases are held right now. Rendered as «4 leases». */
  leaseCount?: number | undefined;
  selectedId?: string | undefined;
  onSelect?: ((row: FileTreeRowData) => void) | undefined;
  /** A file was opened (Enter, click). */
  onActivate?: ((row: FileTreeRowData) => void) | undefined;
  /** A folder was expanded or collapsed. The caller flips `expanded` on the row. */
  onToggle?: ((row: FileTreeRowData) => void) | undefined;
  /** Render the filter field. */
  showFilter?: boolean | undefined;
  /** Controlled filter text. Omit to let the component keep it. */
  filter?: string | undefined;
  onFilterChange?: ((value: string) => void) | undefined;
  loading?: boolean | undefined;
  /** Human-readable failure. Rendered instead of the rows. */
  error?: string | undefined;
  /** Retry handler for the error state. */
  onRetry?: (() => void) | undefined;
  labels?: Partial<FileTreeLabels> | undefined;
}

/**
 * Visible rows for a flat tree: collapsed folders hide their descendants, and a non-empty filter
 * keeps every matching row plus its ancestors (so a match never appears without its path context).
 * Filtering deliberately overrides collapse — you asked for the match, you get the match.
 *
 * Exported because a virtualiser wants the windowed list, not a rendered tree.
 */
export function visibleFileTreeRows(
  rows: readonly FileTreeRowData[],
  filter?: string,
): FileTreeRowData[] {
  const query = (filter ?? '').trim().toLowerCase();

  if (query.length > 0) {
    const keep = new Set<string>();
    const ancestors: FileTreeRowData[] = [];
    for (const row of rows) {
      while (ancestors.length > 0) {
        const last = ancestors[ancestors.length - 1];
        if (last && last.depth >= row.depth) ancestors.pop();
        else break;
      }
      const haystack = `${row.name} ${row.path ?? ''}`.toLowerCase();
      if (haystack.includes(query)) {
        keep.add(row.id);
        for (const ancestor of ancestors) keep.add(ancestor.id);
      }
      ancestors.push(row);
    }
    return rows.filter((row) => keep.has(row.id));
  }

  const out: FileTreeRowData[] = [];
  let collapsedAt: number | null = null;
  for (const row of rows) {
    if (collapsedAt !== null) {
      if (row.depth > collapsedAt) continue;
      collapsedAt = null;
    }
    out.push(row);
    if (row.kind === 'folder' && row.expanded !== true) collapsedAt = row.depth;
  }
  return out;
}

function pluralForm(count: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/**
 * The worktree file tree. Spec §"Дерево файлов · владение зонами": every path under lease carries
 * a 2px identity edge and the holder's avatar chip, so ownership is answered before you hover.
 *
 * Rows arrive flat with a `depth`; the component only ever renders the visible slice, and
 * `visibleFileTreeRows` is exported so a windowing layer can do the same maths.
 *
 * Keyboard: ↑/↓ move, →/← expand/collapse or step in/out, Home/End jump, Enter opens a file or
 * toggles a folder.
 */
export function FileTree({
  rows,
  members,
  identitySet,
  projectName,
  worktree,
  leaseCount,
  selectedId,
  onSelect,
  onActivate,
  onToggle,
  showFilter = false,
  filter,
  onFilterChange,
  loading = false,
  error,
  onRetry,
  labels,
}: FileTreeProps): React.ReactElement {
  const text = useMemo<FileTreeLabels>(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);

  const byId = useMemo(() => {
    const map = new Map<string, Member>();
    for (const member of members ?? []) map.set(member.id, member);
    return map;
  }, [members]);

  const [innerFilter, setInnerFilter] = useState('');
  const filterValue = filter ?? innerFilter;
  const handleFilter = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      if (onFilterChange) onFilterChange(event.target.value);
      else setInnerFilter(event.target.value);
    },
    [onFilterChange],
  );

  const visible = useMemo(() => visibleFileTreeRows(rows, filterValue), [rows, filterValue]);

  /**
   * Rows that start a zone as far as the *visible* list is concerned. Only those get the avatar
   * chip; deeper rows keep the identity edge, which already says «same zone».
   */
  const chipRows = useMemo(() => {
    const ids = new Set<string>();
    const ancestors: FileTreeRowData[] = [];
    for (const row of visible) {
      while (ancestors.length > 0) {
        const last = ancestors[ancestors.length - 1];
        if (last && last.depth >= row.depth) ancestors.pop();
        else break;
      }
      const parent = ancestors[ancestors.length - 1];
      if (row.ownerId && (!parent || parent.ownerId !== row.ownerId)) ids.add(row.id);
      ancestors.push(row);
    }
    return ids;
  }, [visible]);

  const nodes = useRef(new Map<string, HTMLDivElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const rovingId = useMemo(() => {
    const present = (id: string | null | undefined): boolean =>
      Boolean(id) && visible.some((row) => row.id === id);
    if (present(focusedId)) return focusedId;
    if (present(selectedId)) return selectedId ?? null;
    return visible[0]?.id ?? null;
  }, [focusedId, selectedId, visible]);

  const focusAt = useCallback(
    (index: number): void => {
      const target = visible[Math.min(Math.max(index, 0), visible.length - 1)];
      if (!target) return;
      setFocusedId(target.id);
      nodes.current.get(target.id)?.focus();
    },
    [visible],
  );

  const handleKeyDown = useCallback(
    (row: FileTreeRowData, index: number) => (event: KeyboardEvent<HTMLDivElement>): void => {
      const isFolder = row.kind === 'folder';
      const expanded = row.expanded === true;
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusAt(index + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusAt(index - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusAt(0);
          break;
        case 'End':
          event.preventDefault();
          focusAt(visible.length - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          if (isFolder && !expanded) onToggle?.(row);
          else focusAt(index + 1);
          break;
        case 'ArrowLeft': {
          event.preventDefault();
          if (isFolder && expanded) {
            onToggle?.(row);
            break;
          }
          for (let i = index - 1; i >= 0; i -= 1) {
            const candidate = visible[i];
            if (candidate && candidate.depth < row.depth) {
              focusAt(i);
              break;
            }
          }
          break;
        }
        case 'Enter':
          event.preventDefault();
          onSelect?.(row);
          if (isFolder) onToggle?.(row);
          else onActivate?.(row);
          break;
        case ' ':
          event.preventDefault();
          onSelect?.(row);
          break;
        default:
          break;
      }
    },
    [focusAt, onActivate, onSelect, onToggle, visible],
  );

  return (
    <section className={styles.root} aria-label={projectName}>
      <header className={styles.head}>
        <Icon name="worktree" className={styles.headGlyph} />
        <span className={styles.project}>{projectName}</span>
        {worktree ? <span className={styles.worktree}>{worktree}</span> : null}
        {leaseCount != null ? (
          <span className={styles.leases}>
            {leaseCount} {pluralForm(leaseCount, text.leaseForms)}
          </span>
        ) : null}
      </header>

      {showFilter ? (
        <div className={styles.filterRow}>
          <Icon name="search" className={styles.filterGlyph} />
          <input
            type="search"
            className={styles.filterInput}
            value={filterValue}
            placeholder={text.filterPlaceholder}
            aria-label={text.filterLabel}
            onChange={handleFilter}
          />
        </div>
      ) : null}

      {error ? (
        <ErrorState description={error} {...(onRetry ? { onRetry } : {})} />
      ) : loading ? (
        <LoadingState rows={6} withMeta={false} label={text.loading} />
      ) : visible.length === 0 ? (
        <EmptyState title={text.empty} icon={filterValue.trim() ? 'search' : 'folder'} />
      ) : (
        <div className={styles.rows} role="tree" aria-label={text.tree} aria-multiselectable="false">
          {visible.map((row, index) => (
            <FileTreeRow
              key={row.id}
              ref={(el) => {
                if (el) nodes.current.set(row.id, el);
                else nodes.current.delete(row.id);
              }}
              row={row}
              owner={row.ownerId ? byId.get(row.ownerId) : undefined}
              identitySet={identitySet}
              selected={row.id === selectedId}
              tabIndex={row.id === rovingId ? 0 : -1}
              freeLabel={text.free}
              showOwnerChip={chipRows.has(row.id)}
              onSelect={() => onSelect?.(row)}
              onActivate={() => onActivate?.(row)}
              onToggle={() => onToggle?.(row)}
              onKeyDown={handleKeyDown(row, index)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
