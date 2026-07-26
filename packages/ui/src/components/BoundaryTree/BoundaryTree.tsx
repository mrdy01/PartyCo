import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { diffGutterStyle, zoneEdgeStyle, type Member } from '../../identity.ts';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import { IconButton } from '../IconButton/IconButton.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { FileTreeRow, type FileTreeRowData } from '../FileTreeRow/FileTreeRow.tsx';
import { OwnershipBar, type OwnershipShare } from '../OwnershipBar/OwnershipBar.tsx';
import styles from './BoundaryTree.module.css';

/** Chips above the tree. `mine` resolves against `selfId` / the member marked `isSelf`. */
export type BoundaryScope = 'all' | 'mine' | 'taken' | 'free';

export const BOUNDARY_SCOPES: readonly BoundaryScope[] = ['all', 'mine', 'taken', 'free'];

export const BOUNDARY_SCOPE_LABEL: Record<BoundaryScope, string> = {
  all: 'Все',
  mine: 'Мои',
  taken: 'Занятые',
  free: 'Свободные',
};

/** Status colour of a lease sub-row — dot and text only, never the row fill. */
export type BoundaryStatusTone = 'neutral' | 'warning' | 'success' | 'danger';

/**
 * The 22px sub-row under a boundary: «твой lease · активность 4 с», «неактивна 29 мин · TTL 27 с»,
 * «в fast lane · позиция 1». It describes the boundary above it, so it inherits that boundary's
 * `ownerId` — the zone edge and the tint must not break mid-zone.
 */
export interface BoundaryStatusRow {
  id: string;
  kind: 'status';
  /** One deeper than the boundary it belongs to, so collapsing the boundary hides it. */
  depth: number;
  note: string;
  tone?: BoundaryStatusTone | undefined;
  /** Pulse the dot while the situation is still moving — a TTL burning down. */
  pulse?: boolean | undefined;
  ownerId?: string | undefined;
}

/**
 * One row of the flat list. Boundaries and files are ordinary `FileTreeRowData` — a boundary is a
 * `folder`, a file is a `file` — plus the lease sub-rows that sit between them.
 */
export type BoundaryRow = FileTreeRowData | BoundaryStatusRow;

export interface BoundaryTreeLabels {
  title: string;
  declare: string;
  filterPlaceholder: string;
  filterLabel: string;
  /** Accessible name of the chip group. */
  scopeLabel: string;
  /** Accessible name of the tree. */
  tree: string;
  free: string;
  loading: string;
  emptyTitle: string;
  emptyDescription: ReactNode;
  emptyPrimary: string;
  emptySecondary: string;
  noMatchesTitle: string;
  noMatchesDescription: string;
  ownershipPrefix: string;
  /** Russian plural forms for the boundary count: 1 / 2–4 / 5+. */
  boundaryForms: readonly [string, string, string];
}

const DEFAULT_LABELS: BoundaryTreeLabels = {
  title: 'Границы и файлы',
  declare: 'Объявить границу',
  filterPlaceholder: 'Фильтр по пути или владельцу',
  filterLabel: 'Фильтр границ по пути или владельцу',
  scopeLabel: 'Какие границы показывать',
  tree: 'Границы и файлы',
  free: 'свободно',
  loading: 'Загружаем границы…',
  emptyTitle: 'Границы ещё не объявлены',
  emptyDescription: (
    <>
      Без <code className={styles.code}>.partyco/architecture.yaml</code> leases брать не на что.
      Можно вывести черновик из
      графа зависимостей и подтвердить руками.
    </>
  ),
  emptyPrimary: 'Предложить границы',
  emptySecondary: 'Как это работает',
  noMatchesTitle: 'Ничего не найдено',
  noMatchesDescription: 'Ни одна граница не подходит под фильтр.',
  ownershipPrefix: 'Владение',
  boundaryForms: ['граница', 'границы', 'границ'],
};

export interface BoundaryTreeProps {
  /** Flat, in display order, each row carrying its own `depth`. Boundaries sit at depth 0. */
  rows: readonly BoundaryRow[];
  /** Everyone who might hold a lease; used to resolve `ownerId`. */
  members?: readonly Member[] | undefined;
  identitySet?: IdentitySetName | undefined;
  /** The local user, for the «Мои» chip. Defaults to the member marked `isSelf`. */
  selfId?: string | undefined;
  selectedId?: string | undefined;
  onSelect?: ((row: BoundaryRow) => void) | undefined;
  /** A file was opened (Enter, click). */
  onActivate?: ((row: FileTreeRowData) => void) | undefined;
  /** A boundary was expanded or collapsed. The caller flips `expanded` on the row. */
  onToggle?: ((row: FileTreeRowData) => void) | undefined;
  /** Controlled filter text. Omit to let the component keep it. */
  filter?: string | undefined;
  onFilterChange?: ((value: string) => void) | undefined;
  /** Controlled chip selection. Omit to let the component keep it. */
  scope?: BoundaryScope | undefined;
  onScopeChange?: ((scope: BoundaryScope) => void) | undefined;
  /** Header «+». Omit and the button is not rendered. */
  onDeclare?: (() => void) | undefined;
  /** Footer proportion bar. Omit and no footer is rendered. */
  ownership?: readonly OwnershipShare[] | undefined;
  /** Boundaries nobody holds — the neutral remainder of the footer bar. */
  freeCount?: number | undefined;
  /** Footer eyebrow. Defaults to «Владение · 6 границ». */
  ownershipTitle?: string | undefined;
  loading?: boolean | undefined;
  /** Human-readable failure. Rendered instead of the rows. */
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Empty state, primary action. */
  onProposeBoundaries?: (() => void) | undefined;
  /** Empty state, secondary action. */
  onExplain?: (() => void) | undefined;
  labels?: Partial<BoundaryTreeLabels> | undefined;
  className?: string | undefined;
}

function isStatusRow(row: BoundaryRow): row is BoundaryStatusRow {
  return row.kind === 'status';
}

function rowText(row: BoundaryRow): string {
  return isStatusRow(row) ? row.note : `${row.name} ${row.path ?? ''}`;
}

function matchesScope(row: BoundaryRow, scope: BoundaryScope, selfId: string | undefined): boolean {
  if (scope === 'all') return true;
  const { ownerId } = row;
  if (scope === 'free') return !ownerId;
  if (scope === 'taken') return Boolean(ownerId);
  return Boolean(ownerId) && ownerId === selfId;
}

export interface VisibleBoundaryRowsOptions {
  filter?: string | undefined;
  scope?: BoundaryScope | undefined;
  /** Required by the «Мои» chip; ignored by every other scope. */
  selfId?: string | undefined;
}

/**
 * The rows a virtualiser should render, in three passes that compose the way the user expects:
 *
 * 1. the chip narrows to whole boundaries — a boundary's files never outlive their boundary;
 * 2. a non-empty filter keeps every match plus its ancestors, deliberately overriding collapse;
 * 3. otherwise a collapsed boundary hides everything deeper, sub-rows included.
 *
 * Exported so a windowing layer can do the same maths without rendering a tree.
 */
export function visibleBoundaryRows(
  rows: readonly BoundaryRow[],
  options?: VisibleBoundaryRowsOptions,
): BoundaryRow[] {
  const scope = options?.scope ?? 'all';
  const query = (options?.filter ?? '').trim().toLowerCase();

  let scoped: readonly BoundaryRow[] = rows;
  if (scope !== 'all') {
    const out: BoundaryRow[] = [];
    let keeping = false;
    for (const row of rows) {
      if (row.depth === 0) keeping = matchesScope(row, scope, options?.selfId);
      if (keeping) out.push(row);
    }
    scoped = out;
  }

  if (query.length > 0) {
    const keep = new Set<string>();
    const ancestors: BoundaryRow[] = [];
    for (const row of scoped) {
      while (ancestors.length > 0) {
        const last = ancestors[ancestors.length - 1];
        if (last && last.depth >= row.depth) ancestors.pop();
        else break;
      }
      if (rowText(row).toLowerCase().includes(query)) {
        keep.add(row.id);
        for (const ancestor of ancestors) keep.add(ancestor.id);
      }
      ancestors.push(row);
    }
    return scoped.filter((row) => keep.has(row.id));
  }

  const out: BoundaryRow[] = [];
  let collapsedAt: number | null = null;
  for (const row of scoped) {
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
 * The Workspace's left panel. Boundary-first by construction (docs/architecture.md §5.4): a lease
 * is declared over a boundary — a module — and a file only inherits its owner from the boundary it
 * sits in. That is why the mode badge (R / I / X / G) and the avatar chip belong to the boundary
 * row, why the lease sub-row hangs under it, and why the file rows below carry the same 2px edge
 * and tint without repeating the claim.
 *
 * Rows arrive flat with a `depth`, so the list can be windowed; `visibleBoundaryRows` is exported
 * for exactly that.
 *
 * Keyboard: ↑/↓ move, →/← expand/collapse or step in/out, Home/End jump, Enter opens a file or
 * toggles a boundary. Lease sub-rows are reachable too — they carry the TTL, which is the one thing
 * a keyboard user must not have to hover for.
 */
export function BoundaryTree({
  rows,
  members,
  identitySet,
  selfId,
  selectedId,
  onSelect,
  onActivate,
  onToggle,
  filter,
  onFilterChange,
  scope,
  onScopeChange,
  onDeclare,
  ownership,
  freeCount = 0,
  ownershipTitle,
  loading = false,
  error,
  onRetry,
  onProposeBoundaries,
  onExplain,
  labels,
  className,
}: BoundaryTreeProps): ReactElement {
  const text = useMemo<BoundaryTreeLabels>(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);

  const byId = useMemo(() => {
    const map = new Map<string, Member>();
    for (const member of members ?? []) map.set(member.id, member);
    return map;
  }, [members]);

  const selfMemberId = useMemo(
    () => selfId ?? (members ?? []).find((member) => member.isSelf)?.id,
    [members, selfId],
  );

  const [innerFilter, setInnerFilter] = useState('');
  const filterValue = filter ?? innerFilter;
  const handleFilter = useCallback(
    (value: string): void => {
      if (onFilterChange) onFilterChange(value);
      else setInnerFilter(value);
    },
    [onFilterChange],
  );

  const [innerScope, setInnerScope] = useState<BoundaryScope>('all');
  const scopeValue = scope ?? innerScope;
  const handleScope = useCallback(
    (next: BoundaryScope): void => {
      if (onScopeChange) onScopeChange(next);
      else setInnerScope(next);
    },
    [onScopeChange],
  );

  const visible = useMemo(
    () =>
      visibleBoundaryRows(rows, {
        filter: filterValue,
        scope: scopeValue,
        selfId: selfMemberId,
      }),
    [rows, filterValue, scopeValue, selfMemberId],
  );

  /**
   * Rows that start a zone as far as the *visible* list is concerned — in practice the boundary
   * rows. Only those carry the owner's avatar chip; deeper rows keep the edge, which already says
   * «та же зона».
   */
  const chipRows = useMemo(() => {
    const ids = new Set<string>();
    const ancestors: BoundaryRow[] = [];
    for (const row of visible) {
      while (ancestors.length > 0) {
        const last = ancestors[ancestors.length - 1];
        if (last && last.depth >= row.depth) ancestors.pop();
        else break;
      }
      const parent = ancestors[ancestors.length - 1];
      if (!isStatusRow(row) && row.ownerId && (!parent || parent.ownerId !== row.ownerId)) {
        ids.add(row.id);
      }
      ancestors.push(row);
    }
    return ids;
  }, [visible]);

  const nodes = useRef(new Map<string, HTMLElement>());
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
    (row: BoundaryRow, index: number) =>
      (event: KeyboardEvent<HTMLElement>): void => {
        const isFolder = row.kind === 'folder';
        const expanded = !isStatusRow(row) && row.expanded === true;
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
            if (isFolder && !expanded && !isStatusRow(row)) onToggle?.(row);
            else focusAt(index + 1);
            break;
          case 'ArrowLeft': {
            event.preventDefault();
            if (isFolder && expanded && !isStatusRow(row)) {
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
            if (isStatusRow(row)) break;
            onSelect?.(row);
            if (isFolder) onToggle?.(row);
            else onActivate?.(row);
            break;
          case ' ':
            event.preventDefault();
            if (!isStatusRow(row)) onSelect?.(row);
            break;
          default:
            break;
        }
      },
    [focusAt, onActivate, onSelect, onToggle, visible],
  );

  const ownedTotal = (ownership ?? []).reduce((sum, share) => sum + Math.max(0, share.count), 0);
  const boundaryTotal = ownedTotal + Math.max(0, freeCount);
  const footerTitle =
    ownershipTitle ??
    `${text.ownershipPrefix} · ${boundaryTotal} ${pluralForm(boundaryTotal, text.boundaryForms)}`;

  const filtering = filterValue.trim().length > 0 || scopeValue !== 'all';

  let body: ReactElement;
  if (error) {
    body = <ErrorState description={error} {...(onRetry ? { onRetry } : {})} />;
  } else if (loading) {
    body = <LoadingState rows={7} withMeta={false} label={text.loading} />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon="worktree"
        title={text.emptyTitle}
        description={text.emptyDescription}
        actions={[
          {
            label: text.emptyPrimary,
            ...(onProposeBoundaries ? { onClick: onProposeBoundaries } : {}),
          },
          {
            label: text.emptySecondary,
            variant: 'ghost',
            ...(onExplain ? { onClick: onExplain } : {}),
          },
        ]}
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        icon="search"
        title={text.noMatchesTitle}
        description={filtering ? text.noMatchesDescription : undefined}
      />
    );
  } else {
    body = (
      <div className={styles.rows} role="tree" aria-label={text.tree} aria-multiselectable="false">
        {visible.map((row, index) => {
          const owner = row.ownerId ? byId.get(row.ownerId) : undefined;

          if (isStatusRow(row)) {
            const tone = row.tone ?? 'neutral';
            return (
              <div
                key={row.id}
                ref={(el) => {
                  if (el) nodes.current.set(row.id, el);
                  else nodes.current.delete(row.id);
                }}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={false}
                className={styles.status}
                data-tone={tone}
                style={
                  owner ? diffGutterStyle(owner.colorSlug, identitySet) : zoneEdgeStyle(null, identitySet)
                }
                tabIndex={row.id === rovingId ? 0 : -1}
                onKeyDown={handleKeyDown(row, index)}
              >
                <span
                  className={styles.statusIndent}
                  style={{
                    width: `calc(${Math.max(0, row.depth)} * (var(--pc-icon-size) + var(--pc-row-gap)))`,
                  }}
                  aria-hidden="true"
                />
                <span
                  className={styles.statusDot}
                  data-pulse={row.pulse ? 'true' : undefined}
                  aria-hidden="true"
                />
                <span className={styles.statusNote}>{row.note}</span>
              </div>
            );
          }

          return (
            <FileTreeRow
              key={row.id}
              ref={(el) => {
                if (el) nodes.current.set(row.id, el);
                else nodes.current.delete(row.id);
              }}
              row={row}
              owner={owner}
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
          );
        })}
      </div>
    );
  }

  return (
    <section
      className={[styles.root, className ?? ''].filter(Boolean).join(' ')}
      aria-label={text.title}
    >
      <header className={styles.head}>
        <span className={styles.eyebrow}>{text.title}</span>
        {onDeclare ? (
          <IconButton
            icon="plus"
            label={text.declare}
            variant="ghost"
            size="sm"
            className={styles.declare}
            onClick={onDeclare}
          />
        ) : null}
      </header>

      <div className={styles.controls}>
        <SearchField
          value={filterValue}
          placeholder={text.filterPlaceholder}
          label={text.filterLabel}
          onValueChange={handleFilter}
        />
        <div className={styles.chips} role="group" aria-label={text.scopeLabel}>
          {BOUNDARY_SCOPES.map((item) => (
            <button
              key={item}
              type="button"
              className={styles.chip}
              aria-pressed={item === scopeValue}
              onClick={() => handleScope(item)}
            >
              {BOUNDARY_SCOPE_LABEL[item]}
            </button>
          ))}
        </div>
      </div>

      {body}

      {ownership && ownership.length > 0 ? (
        <footer className={styles.footer}>
          <OwnershipBar
            shares={ownership}
            free={freeCount}
            identitySet={identitySet}
            title={footerTitle}
            freeLabel={text.free}
          />
        </footer>
      ) : null}
    </section>
  );
}
