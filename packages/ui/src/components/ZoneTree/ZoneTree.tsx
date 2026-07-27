import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { diffGutterStyle, ownershipAreaStyle, zoneEdgeStyle } from '../../identity.ts';
import type { ProjectMember, ZoneTreeNode } from '../AppShell/model.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { IconButton } from '../IconButton/IconButton.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import styles from './ZoneTree.module.css';

/**
 * The four things the panel can be showing. `empty` is the project that has no zones at all — not
 * "nothing matched a filter", because this tree has no filter: the four scope chips, the R/I/X/G
 * badges and the ownership bar were all removed in this revision. What is left is the coloured edge
 * and the owner's avatar, which is enough to answer "where must I not go".
 */
export type ZoneTreeState = 'ready' | 'empty' | 'loading' | 'error';

export interface ZoneTreeLabels {
  /** Panel heading and the accessible name of the whole panel. */
  title: string;
  /** Accessible name of the search button. */
  search: string;
  /** Accessible name of the "show changes" button. */
  diff: string;
  /** Accessible name of the tree itself. */
  tree: string;
  /** Trailing word on the local user's own zone. */
  mine: string;
  /** Read aloud instead of the padlock glyph. */
  guarded: string;
  /** Read aloud instead of the danger dot. */
  disputed: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  /** The paragraph shown when the project has not been divided into zones yet. */
  emptyBody: string;
  /** The one action under that paragraph. */
  emptyAction: string;
}

const DEFAULT_LABELS: ZoneTreeLabels = {
  title: 'Файлы',
  search: 'Найти файл',
  diff: 'Показать изменения',
  tree: 'Зоны проекта',
  mine: 'твоя',
  guarded: 'файл под защитой',
  disputed: 'здесь спор',
  loading: 'Собираем зоны',
  errorTitle: 'Не получилось показать зоны',
  errorBody: 'Хаб не ответил. Твоя работа на месте — и правки, и зона. Это только просмотр.',
  retry: 'Попробовать снова',
  emptyBody:
    'Проект ещё не поделён на зоны, поэтому делить нечего — работать можно, просто никто никого не подстрахует.',
  emptyAction: 'Разметить зоны',
};

/**
 * Merge that ignores explicitly-passed `undefined`.
 *
 * A plain `{ ...DEFAULT, ...labels }` writes `undefined` over a default whenever the caller builds
 * the override object programmatically — one such partial once wiped a whole block of copy on the
 * leases screen. Spreading is not enough; the value has to be checked.
 */
function withLabels(patch?: Partial<ZoneTreeLabels>): ZoneTreeLabels {
  const out: ZoneTreeLabels = { ...DEFAULT_LABELS };
  if (!patch) return out;
  for (const key of Object.keys(patch) as (keyof ZoneTreeLabels)[]) {
    const value = patch[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export interface ZoneTreeProps {
  /**
   * The rows, flat and in display order — the shape `model.ts` defines. Nesting is not carried by a
   * `children` array: a file belongs to the nearest zone above it, which is the only nesting this
   * panel has and the only one the hub reports.
   */
  nodes: readonly ZoneTreeNode[];
  identitySet?: IdentitySetName | undefined;
  /** Defaults to `ready` when there are rows and `empty` when there are none. */
  state?: ZoneTreeState | undefined;
  /** Wins over `node.selected` when given, for a caller that keeps selection outside the data. */
  selectedId?: string | undefined;
  /** The line under the tree, e.g. «Цветная кромка — чья это зона». */
  footnote?: ReactNode;
  onSelect?: ((node: ZoneTreeNode) => void) | undefined;
  /** A file was opened — Enter or a click. Zones toggle instead. */
  onOpen?: ((node: ZoneTreeNode) => void) | undefined;
  /**
   * A zone was expanded or collapsed. The caller flips `expanded` on the node. Omit and no zone
   * draws a twisty and none reports `aria-expanded` — the rows still show what the data says is
   * open, they simply stop offering to change it.
   */
  onToggle?: ((node: ZoneTreeNode) => void) | undefined;
  /** Omit and the header button is not rendered — a dead control is worse than no control. */
  onSearch?: (() => void) | undefined;
  onDiff?: (() => void) | undefined;
  /** The empty state's one action. Omit and the empty state is a paragraph without a button. */
  onMarkZones?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  labels?: Partial<ZoneTreeLabels> | undefined;
  className?: string | undefined;
}

/**
 * Rows a collapsed zone hides. Exported for the same reason `visibleFileTreeRows` is: a windowing
 * layer needs the list, not the rendered tree.
 */
export function visibleZoneTreeRows(nodes: readonly ZoneTreeNode[]): ZoneTreeNode[] {
  const out: ZoneTreeNode[] = [];
  let collapsed = false;
  for (const node of nodes) {
    if (node.kind === 'zone') {
      collapsed = node.expanded !== true;
      out.push(node);
      continue;
    }
    if (!collapsed) out.push(node);
  }
  return out;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Identity roles #2 and #3 (and #4 for the selected row), never assembled by hand.
 *
 * A held row gets the 2px owner edge plus the gutter-strength wash; the selected row keeps the same
 * hue and steps up to the ownership-area strength, which is exactly the pair of alphas the export
 * draws (0.09 → 0.13). Unclaimed ground gets a transparent edge so every row still starts at the
 * same x, and its selection falls back to the neutral row highlight in the stylesheet.
 */
function rowStyle(
  owner: ProjectMember | undefined,
  selected: boolean,
  set?: IdentitySetName,
): CSSProperties {
  if (!owner) return zoneEdgeStyle(null, set);
  if (!selected) return diffGutterStyle(owner.colorSlug, set);
  const area = ownershipAreaStyle(owner.colorSlug, set ? { set } : {});
  return {
    ...zoneEdgeStyle(owner.colorSlug, set),
    ...(area.background !== undefined ? { background: area.background } : {}),
  };
}

/**
 * The «Файлы» panel: 236px of zones, the files inside the zone you are working in, and one line of
 * explanation at the bottom.
 *
 * Deliberately poorer than `FileTree` / `BoundaryTree`, which stay on the leases screen with their
 * filters, lease-mode badges and counters. Here a row answers one question — whose ground is this —
 * and it answers it with a coloured edge and an avatar, without being asked.
 *
 * Keyboard: ↑/↓ move, → expands a zone or steps in, ← collapses it or steps out to the zone,
 * Home/End jump, Enter opens a file or toggles a zone.
 */
export function ZoneTree({
  nodes,
  identitySet,
  state,
  selectedId,
  footnote,
  onSelect,
  onOpen,
  onToggle,
  onSearch,
  onDiff,
  onMarkZones,
  onRetry,
  labels,
  className,
}: ZoneTreeProps): ReactElement {
  const text = useMemo(() => withLabels(labels), [labels]);
  const visible = useMemo(() => visibleZoneTreeRows(nodes), [nodes]);

  /**
   * Owner per row. A file has no owner of its own in the data model — it inherits the zone it sits
   * in, which is what makes the coloured edge run unbroken down a zone's files.
   */
  const owners = useMemo(() => {
    const map = new Map<string, ProjectMember>();
    let zoneOwner: ProjectMember | undefined;
    for (const node of nodes) {
      if (node.kind === 'zone') zoneOwner = node.owner;
      const owner = node.owner ?? zoneOwner;
      if (owner) map.set(node.id, owner);
    }
    return map;
  }, [nodes]);

  const rowNodes = useRef(new Map<string, HTMLDivElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const isSelected = useCallback(
    (node: ZoneTreeNode): boolean =>
      selectedId !== undefined ? node.id === selectedId : node.selected === true,
    [selectedId],
  );

  const rovingId = useMemo(() => {
    const present = (id: string | null | undefined): boolean =>
      Boolean(id) && visible.some((node) => node.id === id);
    if (present(focusedId)) return focusedId;
    const selected = visible.find((node) => isSelected(node));
    if (selected) return selected.id;
    return visible[0]?.id ?? null;
  }, [focusedId, isSelected, visible]);

  const focusAt = useCallback(
    (index: number): void => {
      const target = visible[Math.min(Math.max(index, 0), visible.length - 1)];
      if (!target) return;
      setFocusedId(target.id);
      rowNodes.current.get(target.id)?.focus();
    },
    [visible],
  );

  const activate = useCallback(
    (node: ZoneTreeNode): void => {
      onSelect?.(node);
      if (node.kind === 'zone') onToggle?.(node);
      else onOpen?.(node);
    },
    [onOpen, onSelect, onToggle],
  );

  const handleKeyDown = useCallback(
    (node: ZoneTreeNode, index: number) =>
      (event: KeyboardEvent<HTMLDivElement>): void => {
        const isZone = node.kind === 'zone';
        const expanded = node.expanded === true;
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
            // With no `onToggle` a zone cannot open, so the key does the other useful thing rather
            // than nothing at all — a dead key is as much a lie as a dead button.
            if (isZone && !expanded && onToggle) onToggle(node);
            else focusAt(index + 1);
            break;
          case 'ArrowLeft': {
            event.preventDefault();
            if (isZone && expanded && onToggle) {
              onToggle(node);
              break;
            }
            // A file steps out to the zone that holds it — the only parent this tree has.
            for (let i = index - 1; i >= 0; i -= 1) {
              if (visible[i]?.kind === 'zone') {
                focusAt(i);
                break;
              }
            }
            break;
          }
          case 'Enter':
            event.preventDefault();
            activate(node);
            break;
          case ' ':
            event.preventDefault();
            onSelect?.(node);
            break;
          default:
            break;
        }
      },
    [activate, focusAt, onSelect, onToggle, visible],
  );

  const declared: ZoneTreeState = state ?? (nodes.length > 0 ? 'ready' : 'empty');
  // A tree with no rows is the empty state whatever the caller said — `role="tree"` with no
  // `treeitem` inside it is both an accessibility error and a blank panel with nothing to read.
  const effective: ZoneTreeState =
    declared === 'ready' && visible.length === 0 ? 'empty' : declared;

  /**
   * The one trailing mark a row may carry. Exactly one, by design — the row is read in a 236px
   * column at a glance, and two competing marks make it a puzzle.
   *
   * A zone says who holds it; a file says what happened to it. The two sets never overlap in the
   * data, so the split is by `kind` rather than by a priority list nobody could remember.
   */
  const trailing = (node: ZoneTreeNode, owner: ProjectMember | undefined): ReactNode => {
    if (node.kind === 'zone') {
      if (node.flagged) {
        return <span className={styles.flag} role="img" aria-label={text.disputed} />;
      }
      if (node.state === 'mine') return <span className={styles.mine}>{text.mine}</span>;
      if (owner) return <Avatar member={owner} size="xs" identitySet={identitySet} />;
      return null;
    }
    if (node.addedLabel) return <span className={styles.added}>{node.addedLabel}</span>;
    if (node.guarded) return <Icon name="lease" className={styles.lock} label={text.guarded} />;
    if (node.flagged) {
      return <span className={styles.flag} role="img" aria-label={text.disputed} />;
    }
    return null;
  };

  let body: ReactNode;
  if (effective === 'error') {
    body = (
      <div className={styles.state}>
        <ErrorState
          title={text.errorTitle}
          description={text.errorBody}
          retryLabel={text.retry}
          {...(onRetry ? { onRetry } : {})}
        />
      </div>
    );
  } else if (effective === 'loading') {
    body = (
      <div className={styles.state}>
        <LoadingState rows={8} withMeta={false} label={text.loading} />
      </div>
    );
  } else if (effective === 'empty') {
    body = (
      <div className={styles.state}>
        <EmptyState
          title={text.emptyBody}
          icon="folder"
          /* Same rule as the header buttons: without a handler the action is not drawn at all,
             because a button that answers nothing is worse than a paragraph on its own. */
          {...(onMarkZones
            ? { actions: [{ label: text.emptyAction, onClick: onMarkZones }] }
            : {})}
        />
      </div>
    );
  } else {
    body = (
      <div className={styles.rows} role="tree" aria-label={text.tree} aria-multiselectable="false">
        {visible.map((node, index) => {
          const owner = owners.get(node.id);
          const selected = isSelected(node);
          const isZone = node.kind === 'zone';
          /*
           * Whether *this* row does anything when pressed, not whether the panel is wired up in
           * general: a zone answers to select and toggle, a file to select and open. A row that
           * answers to neither keeps its place in the keyboard walk — reading a tree is a real use
           * of it — but drops the pointer cursor, the hover outline and the click handler, because
           * those three together say «нажми меня» and it has nothing to give back.
           */
          const actionable = isZone
            ? Boolean(onSelect ?? onToggle)
            : Boolean(onSelect ?? onOpen);
          return (
            <div
              key={node.id}
              ref={(el) => {
                if (el) rowNodes.current.set(node.id, el);
                else rowNodes.current.delete(node.id);
              }}
              role="treeitem"
              aria-level={isZone ? 1 : 2}
              aria-selected={selected}
              /* `aria-expanded` is a claim that this row can be opened and closed. */
              aria-expanded={isZone && onToggle ? node.expanded === true : undefined}
              tabIndex={node.id === rovingId ? 0 : -1}
              title={node.label}
              data-static={actionable ? undefined : 'true'}
              className={cx(
                styles.row,
                selected && styles.selected,
                // Your own zone's heading and the row you are looking at read brighter. The files
                // inside your zone do not: the edge already says they are yours, and five bright
                // rows in a row say nothing at all.
                (selected || (isZone && node.state === 'mine')) && styles.strong,
              )}
              style={rowStyle(owner, selected, identitySet)}
              {...(actionable ? { onClick: () => activate(node) } : {})}
              onKeyDown={handleKeyDown(node, index)}
            >
              {/*
               * The twisty is the one part of the row that promises a specific act — «здесь ещё
               * что-то, нажми». Without `onToggle` nothing can open, so it gives way to the spacer
               * the files already use and the column stays aligned to the same x.
               */}
              {isZone && onToggle ? (
                <Icon
                  name="chevron-right"
                  className={cx(styles.twisty, node.expanded === true && styles.twistyOpen)}
                />
              ) : (
                <span className={styles.indent} aria-hidden="true" />
              )}
              {isZone ? null : <Icon name="file" className={styles.glyph} />}
              <span className={styles.name}>{node.label}</span>
              <span className={styles.trailing}>{trailing(node, owner)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className={cx(styles.root, className)} aria-label={text.title}>
      <header className={styles.head}>
        <span className={styles.title}>{text.title}</span>
        <span className={styles.headEnd}>
          {onSearch ? (
            <IconButton icon="search" label={text.search} variant="ghost" size="sm" onClick={onSearch} />
          ) : null}
          {onDiff ? (
            <IconButton icon="diff" label={text.diff} variant="ghost" size="sm" onClick={onDiff} />
          ) : null}
        </span>
      </header>

      <div className={styles.panel}>
        {body}
        {/* The footnote explains the coloured edge, so it only belongs where edges are drawn. */}
        {footnote && effective === 'ready' ? (
          <div className={styles.foot}>
            <p className={styles.footText}>{footnote}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
