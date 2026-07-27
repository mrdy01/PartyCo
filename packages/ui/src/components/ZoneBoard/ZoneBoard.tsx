import {
  useCallback,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import {
  freeAreaStyle,
  identityGutterVar,
  ownershipAreaStyle,
  zoneEdgeStyle,
  type Member,
} from '../../identity.ts';
import type { OwnershipTab, ZoneCardData, ZoneTableRow } from '../AppShell/model.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { EmptyState, type StateAction } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState, type LoadingStateColumn } from '../LoadingState/LoadingState.tsx';
import { Skeleton } from '../Skeleton/Skeleton.tsx';
import styles from './ZoneBoard.module.css';

/* ------------------------------------------------------------------ model */

/**
 * Which of the board's own four faces is on screen. `ready` is the data; the other three are
 * CONVENTIONS §6's mandatory trio, and they are a prop rather than an inference because a caller
 * that has zero zones and a caller that has not asked yet are two different sentences.
 *
 * The state governs the board's OWN data — the cards and the table. The merge queue arrives through
 * `renderQueue` and owns its states itself; `loading` and `error` still cover it, because a view
 * that cannot reach the hub cannot reach the queue either.
 */
export type ZoneBoardState = 'ready' | 'loading' | 'empty' | 'error';

/** Reading order of the segmented switch. The queue is a tab here, never a rail entry. */
export const ZONE_BOARD_TABS: readonly OwnershipTab[] = ['zones', 'queue'];

export interface ZoneBoardColumnLabels {
  path: string;
  holder: string;
  doing: string;
  release: string;
  action: string;
}

export interface ZoneBoardLabels {
  /** Heading of the view. */
  title: string;
  /** Accessible name of the segmented switch. */
  tabsLabel: string;
  tabs: Record<OwnershipTab, string>;
  /** Accessible name of the card grid. */
  cardsLabel: string;
  /** Right-hand marker on the local user's own card. */
  self: string;
  /** Second line of a card nobody holds, when the data brings none. */
  free: string;
  /** Chip on a disputed card, when the data brings none. */
  disputed: string;
  /** Read by assistive tech instead of being painted. */
  tableCaption: string;
  columns: ZoneBoardColumnLabels;
  /** Holder cell of a row nobody holds. */
  noHolder: string;
  emptyTitle: string;
  emptyBody: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
  queueEmptyTitle: string;
  queueEmptyBody: string;
}

export type ZoneBoardLabelsInput = Partial<Omit<ZoneBoardLabels, 'tabs' | 'columns'>> & {
  tabs?: Partial<Record<OwnershipTab, string>> | undefined;
  columns?: Partial<ZoneBoardColumnLabels> | undefined;
};

export const ZONE_BOARD_LABELS: ZoneBoardLabels = {
  title: 'Владение',
  tabsLabel: 'Что показать',
  tabs: {
    zones: 'Кто чем занят',
    queue: 'Очередь на влитие',
  },
  cardsLabel: 'Зоны проекта',
  self: 'это ты',
  free: 'Свободно',
  disputed: 'Спорная правка',
  tableCaption: 'Кто какую зону держит, что делает и когда она освободится',
  columns: {
    path: 'Зона',
    holder: 'Кто держит',
    doing: 'Что делает',
    release: 'Когда освободится',
    action: 'Действие',
  },
  noHolder: 'Никто',
  emptyTitle: 'Границ проекта ещё нет',
  emptyBody:
    'Проект не поделён на зоны, поэтому делить нечего — работать можно, просто никто никого не подстрахует.',
  loading: 'Смотрим, кто чем занят…',
  errorTitle: 'Не получилось показать владение',
  errorBody: 'Хаб не ответил. Зоны на месте — не отвечает только их список.',
  errorRetry: 'Попробовать снова',
  queueEmptyTitle: 'Очередь пуста',
  queueEmptyBody: 'На влитие сейчас никто ничего не отправил.',
};

/**
 * Merged one level deeper than the spread, on purpose: a caller who overrides a single column name
 * with a shallow spread would otherwise wipe out the other four. That has happened once already.
 */
function mergeLabels(input?: ZoneBoardLabelsInput): ZoneBoardLabels {
  if (!input) return ZONE_BOARD_LABELS;
  return {
    ...ZONE_BOARD_LABELS,
    ...input,
    tabs: { ...ZONE_BOARD_LABELS.tabs, ...input.tabs },
    columns: { ...ZONE_BOARD_LABELS.columns, ...input.columns },
  };
}

/* ------------------------------------------------------------------ props */

export interface ZoneBoardProps {
  /** Controlled tab. Leave out and the board keeps its own. */
  tab?: OwnershipTab | undefined;
  defaultTab?: OwnershipTab | undefined;
  onTabChange?: ((tab: OwnershipTab) => void) | undefined;
  /** The card grid. Three across, in the order given — the board never re-sorts. */
  cards?: readonly ZoneCardData[] | undefined;
  /** The table under the grid. Deliberately simpler than `LeaseTable`: no sorting, no grouping. */
  rows?: readonly ZoneTableRow[] | undefined;
  /** Appended to the queue tab as «Очередь на влитие · 2». Omit and the tab is bare. */
  queueCount?: number | undefined;
  /** Tail of the header: «Обновляется само · шесть границ проекта». */
  meta?: ReactNode;
  /** The plate with the `info` glyph under the table. Omit to drop the plate. */
  footnote?: ReactNode;
  identitySet?: IdentitySetName | undefined;
  /** Omit and no card draws its action button, whatever `card.action` says. */
  onCardAction?: ((card: ZoneCardData, actionId: string) => void) | undefined;
  /** Omit and no row draws its action link, whatever `row.action` says. */
  onRowAction?: ((row: ZoneTableRow, actionId: string) => void) | undefined;
  /**
   * Body of the queue tab. Rendered only while that tab is active, so the caller's
   * `MergeQueueTable` / `LaneDiagram` never mount behind a tab nobody opened.
   */
  renderQueue?: (() => ReactNode) | undefined;
  state?: ZoneBoardState | undefined;
  /** Replaces the standard error sentence with what actually failed. */
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Offered under the empty state, e.g. «Разметить зоны». */
  emptyActions?: StateAction[] | undefined;
  skeletonCards?: number | undefined;
  skeletonRows?: number | undefined;
  labels?: ZoneBoardLabelsInput | undefined;
  className?: string | undefined;
}

/* -------------------------------------------------------------- internals */

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** The board addresses people the way the design does — by first name. */
function firstName(member: Member): string {
  return member.name.trim().split(/\s+/)[0] ?? member.name;
}

/**
 * The status tone a card's chip carries. Taken off `ZoneCardData` rather than restated, so the
 * board cannot drift from the vocabulary in `model.ts`.
 */
type ZoneChipTone = NonNullable<ZoneCardData['chip']>['tone'];

/** `ownershipAreaStyle` takes an exact-optional bag, so build it instead of passing `undefined`. */
function areaOptions(
  set: IdentitySetName | undefined,
  outline: ZoneChipTone | undefined,
): { set?: IdentitySetName; outlineStatus?: ZoneChipTone } {
  const opts: { set?: IdentitySetName; outlineStatus?: ZoneChipTone } = {};
  if (set) opts.set = set;
  if (outline) opts.outlineStatus = outline;
  return opts;
}

/**
 * The card's surface.
 *
 * `mine` and `held` both get identity role #4 — the member's colour as the AREA that says "this
 * belongs to them" — plus the 2px left edge that says the same thing everywhere else in the product.
 * The difference is the rest of the perimeter: on someone else's card it carries the zone's state
 * (§5's outline role), which is exactly the split `ownershipAreaStyle` was written for. `free` is
 * the dashed neutral; `disputed` is left to the stylesheet, because its danger outline is a status
 * colour and no identity is involved.
 */
function cardSurface(card: ZoneCardData, set: IdentitySetName | undefined): CSSProperties {
  if (card.state === 'free' || card.state === 'disputed') {
    return card.state === 'free' ? freeAreaStyle() : {};
  }
  if (!card.holder) return freeAreaStyle();
  const outline = card.state === 'held' ? card.chip?.tone : undefined;
  return ownershipAreaStyle(card.holder.colorSlug, areaOptions(set, outline));
}

const LOADING_COLUMNS: readonly LoadingStateColumn[] = [
  { width: '30ch' },
  { width: '18ch' },
  { width: '26ch' },
  { width: '28ch' },
  { width: '1fr' },
];

/* ----------------------------------------------------------------- the view */

/**
 * «Владение» — the separate, on-demand view the rail switches to, with the merge queue as its
 * second tab rather than as a screen of its own.
 *
 * Two readings of the same fact, one above the other: the grid answers «кто чем занят» at a glance,
 * the table answers «когда освободится» line by line. Neither is a fork of anything — `OwnershipMap`
 * still owns the treemap on the leases screen and `LeaseTable` still owns sorting, grouping and the
 * guarded-path footer, both of which this surface deliberately does without.
 *
 * Colour discipline (CONVENTIONS §5): every identity colour on screen arrives from an `identity.ts`
 * helper — the avatar fill, the card's ownership area, the 2px left edge of a card and of a table
 * row, and the gutter-strength tint on the local user's own row. Status colour stays a dot, a text
 * tone or an outline; it never fills a card and never takes a left edge.
 */
export function ZoneBoard({
  tab,
  defaultTab = 'zones',
  onTabChange,
  cards = [],
  rows = [],
  queueCount,
  meta,
  footnote,
  identitySet,
  onCardAction,
  onRowAction,
  renderQueue,
  state = 'ready',
  error,
  onRetry,
  emptyActions,
  skeletonCards = 6,
  skeletonRows = 3,
  labels: labelsInput,
  className,
}: ZoneBoardProps): ReactElement {
  const labels = mergeLabels(labelsInput);
  const baseId = useId();

  const [ownTab, setOwnTab] = useState<OwnershipTab>(defaultTab);
  const activeTab = tab ?? ownTab;

  /**
   * Can the switch actually switch?
   *
   * Uncontrolled, it always can — the board keeps the tab itself. Controlled, only the caller can
   * move it, so without `onTabChange` pressing «Очередь на влитие» would leave the board exactly
   * where it was. That case draws the current tab as a caption instead of a tablist: the person
   * still reads which of the two faces they are looking at, and is not offered a door that is
   * painted on.
   */
  const switchable = tab === undefined || onTabChange !== undefined;

  /** «Очередь на влитие · 2» — one wording, used by the switch and by the caption alike. */
  const tabLabel = (id: OwnershipTab): string =>
    id === 'queue' && queueCount !== undefined
      ? `${labels.tabs.queue} · ${queueCount}`
      : labels.tabs[id];

  const tabRefs = useRef(new Map<OwnershipTab, HTMLButtonElement | null>());

  const tabDomId = (id: OwnershipTab): string => `${baseId}-tab-${id}`;
  /**
   * One id for one panel. Only the active tab's body is mounted, so a per-tab id would leave the
   * inactive tab's `aria-controls` pointing at an element that does not exist — a dangling IDREF
   * that a screen reader reports as a broken control.
   */
  const panelDomId = `${baseId}-panel`;

  const selectTab = useCallback(
    (next: OwnershipTab): void => {
      if (tab === undefined) setOwnTab(next);
      onTabChange?.(next);
    },
    [tab, onTabChange],
  );

  const stepTab = useCallback(
    (delta: 1 | -1): void => {
      const at = ZONE_BOARD_TABS.indexOf(activeTab);
      const size = ZONE_BOARD_TABS.length;
      const next = ZONE_BOARD_TABS[(at + delta + size) % size];
      if (!next) return;
      selectTab(next);
      tabRefs.current.get(next)?.focus();
    },
    [activeTab, selectTab],
  );

  const edgeTab = useCallback(
    (last: boolean): void => {
      const next = last ? ZONE_BOARD_TABS[ZONE_BOARD_TABS.length - 1] : ZONE_BOARD_TABS[0];
      if (!next) return;
      selectTab(next);
      tabRefs.current.get(next)?.focus();
    },
    [selectTab],
  );

  const onTabsKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          stepTab(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          stepTab(-1);
          break;
        case 'Home':
          event.preventDefault();
          edgeTab(false);
          break;
        case 'End':
          event.preventDefault();
          edgeTab(true);
          break;
        default:
          break;
      }
    },
    [edgeTab, stepTab],
  );

  /* ---------------------------------------------------------------- pieces */

  const renderCard = (card: ZoneCardData): ReactElement => {
    const holder = card.holder;
    const owned = card.state === 'mine' || card.state === 'held';
    const chip = card.chip;
    const action = card.action;
    // «Правишь · 4 минуты» over «14.2 тысячи строк» on my own card; over «отпустится сама через
    // 3 минуты» on someone else's. One slot, because the card has room for exactly one.
    const tail = card.release ?? card.size;

    return (
      <li
        key={card.path}
        className={styles.card}
        data-state={card.state}
        style={cardSurface(card, identitySet)}
      >
        {owned && holder ? (
          <div className={styles.cardHead}>
            {/* The name is real text right next to it, so the avatar is decoration. */}
            <Avatar member={holder} size="sm" identitySet={identitySet} decorative />
            <span className={styles.cardName}>{firstName(holder)}</span>
            {card.state === 'mine' ? (
              <span className={styles.cardSelf}>{labels.self}</span>
            ) : chip ? (
              <span className={styles.chip} data-tone={chip.tone}>
                <span className={styles.dot} aria-hidden="true" />
                {chip.label}
              </span>
            ) : null}
          </div>
        ) : null}

        <span className={styles.cardPath} title={card.path}>
          {card.path}
        </span>

        {card.state === 'free' ? (
          <span className={styles.cardFree}>{card.activity ?? labels.free}</span>
        ) : null}

        {card.state === 'disputed' ? (
          <span className={styles.chip} data-tone={chip?.tone ?? 'danger'} data-flow="true">
            <span className={styles.dot} aria-hidden="true" />
            {chip?.label ?? labels.disputed}
          </span>
        ) : null}

        {card.note ? <p className={styles.cardNote}>{card.note}</p> : null}

        {owned ? (
          <div className={styles.cardFoot}>
            {card.activity ? <span className={styles.cardActivity}>{card.activity}</span> : null}
            {tail ? <span className={styles.cardMeta}>{tail}</span> : null}
          </div>
        ) : null}

        {/* The data may offer an action the caller cannot run; then the card carries none. A
            «Взять зону» that takes no zone is worse than a card that does not offer one. */}
        {action && onCardAction ? (
          <Button
            size="md"
            variant="secondary"
            className={styles.cardAction}
            /* «Взять зону» appears on every free card; without the path they are indistinguishable
               to anyone reading the page through assistive tech. */
            aria-label={`${action.label} · ${card.path}`}
            onClick={() => onCardAction(card, action.id)}
          >
            {action.label}
          </Button>
        ) : null}
      </li>
    );
  };

  const renderRow = (row: ZoneTableRow): ReactElement => {
    const holder = row.holder;
    const action = row.action;
    // Identity role #2 — the 2px left edge naming the holder, the same edge the file tree draws.
    const edge = zoneEdgeStyle(holder ? holder.colorSlug : null, identitySet);
    // Identity role #4 at gutter strength: the area of a row that is mine. `LeaseTable` and `Tabs`
    // already make this exact call, so the three surfaces tint an owned row identically.
    const tint =
      holder && holder.isSelf === true
        ? { background: identityGutterVar(holder.colorSlug, identitySet) }
        : null;

    return (
      <tr key={row.path} className={styles.row}>
        <th scope="row" className={styles.cellPath} style={{ ...edge, ...tint }} title={row.path}>
          {row.path}
        </th>
        <td className={styles.cellHolder} style={tint ?? undefined}>
          {holder ? (
            <span className={styles.holder}>
              <Avatar member={holder} size="xs" identitySet={identitySet} decorative />
              <span className={styles.holderName}>{firstName(holder)}</span>
            </span>
          ) : (
            <span className={styles.muted}>{labels.noHolder}</span>
          )}
        </td>
        <td className={styles.cellDoing} style={tint ?? undefined}>
          {row.doing}
        </td>
        <td className={styles.cellRelease} style={tint ?? undefined}>
          <span className={styles.release} data-tone={row.releaseTone ?? undefined}>
            {row.releaseTone ? <span className={styles.dot} aria-hidden="true" /> : null}
            <span className={styles.releaseText}>{row.release}</span>
          </span>
        </td>
        <td className={styles.cellAction} style={tint ?? undefined}>
          {/* Same rule as the card: the link exists only where the request actually goes out. */}
          {action && onRowAction ? (
            <button
              type="button"
              className={styles.link}
              /* Three rows, two of them «Попросить» — the path is what tells them apart. */
              aria-label={`${action.label} · ${row.path}`}
              onClick={() => onRowAction(row, action.id)}
            >
              {action.label}
            </button>
          ) : null}
        </td>
      </tr>
    );
  };

  const table = (
    <div className={styles.tablePanel}>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>{labels.tableCaption}</caption>
          <colgroup>
            <col className={styles.colPath} />
            <col className={styles.colHolder} />
            <col className={styles.colDoing} />
            <col className={styles.colRelease} />
            <col className={styles.colAction} />
          </colgroup>
          <thead className={styles.head}>
            <tr>
              <th scope="col" className={styles.headCell}>
                {labels.columns.path}
              </th>
              <th scope="col" className={styles.headCell}>
                {labels.columns.holder}
              </th>
              <th scope="col" className={styles.headCell}>
                {labels.columns.doing}
              </th>
              <th scope="col" className={styles.headCell}>
                {labels.columns.release}
              </th>
              <th scope="col" className={styles.headCell} data-align="end">
                {labels.columns.action}
              </th>
            </tr>
          </thead>
          <tbody>{rows.map(renderRow)}</tbody>
        </table>
      </div>
    </div>
  );

  const skeleton = (
    <div className={styles.loading}>
      <ul className={styles.grid} aria-hidden="true">
        {Array.from({ length: Math.max(1, skeletonCards) }, (_, index) => (
          <li key={index} className={styles.cardGhost}>
            <Skeleton variant="block" width="100%" height="100%" radius="md" />
          </li>
        ))}
      </ul>
      <div className={styles.tablePanel}>
        <LoadingState
          rows={Math.max(1, skeletonRows)}
          columns={LOADING_COLUMNS}
          caption={labels.loading}
          label={labels.loading}
          className={styles.loadingRows ?? ''}
        />
      </div>
    </div>
  );

  const errorBlock = (
    <ErrorState
      className={styles.state ?? ''}
      title={labels.errorTitle}
      description={error ?? labels.errorBody}
      retryLabel={labels.errorRetry}
      {...(onRetry ? { onRetry } : null)}
    />
  );

  const renderZones = (): ReactNode => {
    if (state === 'error') return errorBlock;
    if (state === 'loading') return skeleton;
    if (state === 'empty' || (cards.length === 0 && rows.length === 0)) {
      return (
        <EmptyState
          className={styles.state ?? ''}
          icon="worktree"
          title={labels.emptyTitle}
          description={labels.emptyBody}
          {...(emptyActions ? { actions: emptyActions } : null)}
        />
      );
    }

    return (
      <>
        {cards.length > 0 ? (
          <ul className={styles.grid} aria-label={labels.cardsLabel}>
            {cards.map(renderCard)}
          </ul>
        ) : null}
        {rows.length > 0 ? table : null}
        {footnote ? (
          <div className={styles.footnote}>
            <Icon name="info" size={14} strokeWidth={1.4} className={styles.footnoteIcon} />
            <p className={styles.footnoteText}>{footnote}</p>
          </div>
        ) : null}
      </>
    );
  };

  const renderQueueTab = (): ReactNode => {
    if (state === 'error') return errorBlock;
    if (state === 'loading') {
      return (
        <LoadingState
          rows={Math.max(1, skeletonRows)}
          caption={labels.loading}
          label={labels.loading}
          className={styles.state ?? ''}
        />
      );
    }
    const body = renderQueue?.();
    if (body !== undefined && body !== null && body !== false) return body;
    return (
      <EmptyState
        className={styles.state ?? ''}
        icon="merge"
        tone="success"
        title={labels.queueEmptyTitle}
        description={labels.queueEmptyBody}
      />
    );
  };

  return (
    <section className={cx(styles.root, className)} aria-labelledby={`${baseId}-title`}>
      <header className={styles.header}>
        <h2 className={styles.title} id={`${baseId}-title`}>
          {labels.title}
        </h2>
        {switchable ? (
          <div
            className={styles.tabs}
            role="tablist"
            aria-label={labels.tabsLabel}
            onKeyDown={onTabsKeyDown}
          >
            {ZONE_BOARD_TABS.map((id) => {
              const active = id === activeTab;
              return (
                <button
                  key={id}
                  ref={(node) => {
                    tabRefs.current.set(id, node);
                  }}
                  type="button"
                  role="tab"
                  id={tabDomId(id)}
                  className={styles.tab}
                  data-active={active || undefined}
                  aria-selected={active}
                  aria-controls={panelDomId}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectTab(id)}
                >
                  {tabLabel(id)}
                </button>
              );
            })}
          </div>
        ) : (
          <div className={styles.tabs}>
            <span className={styles.tab} data-active="true" data-static="true">
              {tabLabel(activeTab)}
            </span>
          </div>
        )}
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </header>

      <div
        className={styles.body}
        /* No tablist, no tabpanel: `aria-labelledby` would point at a tab that is not in the page,
           and a dangling IDREF is reported as a broken control. */
        {...(switchable
          ? {
              role: 'tabpanel' as const,
              id: panelDomId,
              'aria-labelledby': tabDomId(activeTab),
            }
          : { role: 'group' as const, 'aria-label': tabLabel(activeTab) })}
        aria-busy={state === 'loading' || undefined}
      >
        {activeTab === 'zones' ? renderZones() : renderQueueTab()}
      </div>
    </section>
  );
}
