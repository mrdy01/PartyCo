import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import {
  avatarStyle,
  freeAreaStyle,
  ownershipAreaStyle,
  zoneEdgeStyle,
  type Member,
} from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { EmptyState, type StateAction } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import { LEASE_MODE_BADGE, LEASE_MODE_LABEL, type LeaseMode } from '../FileTreeRow/FileTreeRow.tsx';
import styles from './OwnershipMap.module.css';

/**
 * What the rectangles are coloured by. Only `owners` uses identity colour — a mode and an age are
 * not people, so painting them with somebody's colour would make the map lie (spec §5).
 */
export type OwnershipMapColorBy = 'owners' | 'modes' | 'age';

export const OWNERSHIP_MAP_COLOR_BY: readonly OwnershipMapColorBy[] = ['owners', 'modes', 'age'];

/** Status semantics a rectangle's outline (and its state line) may carry. */
export type OwnershipMapTone = 'success' | 'warning' | 'danger' | 'running';

/**
 * How long the lease on a boundary has been running. Four buckets rather than a raw number: the
 * map answers «что засиделось», and a continuous ramp of greys is unreadable at this size.
 */
export type OwnershipAgeBucket = 'fresh' | 'recent' | 'aging' | 'stale';

export const OWNERSHIP_AGE_BUCKETS: readonly OwnershipAgeBucket[] = [
  'fresh',
  'recent',
  'aging',
  'stale',
];

/**
 * Age reads as status *text* only — the fill stays on the neutral ramp. A young lease is a good
 * sign, an old one is the thing worth touching; the two middle buckets are simply facts.
 */
const AGE_TONE: Record<OwnershipAgeBucket, OwnershipMapTone | undefined> = {
  fresh: 'success',
  recent: undefined,
  aging: undefined,
  stale: 'warning',
};

/**
 * One boundary. Flat on purpose — the component computes the layout, so a caller never has to
 * pre-nest rows into rows, and the same array feeds the map, the table and the summary bar.
 */
export interface OwnershipMapRow {
  id: string;
  /** Boundary path, e.g. `packages/economy`. Ellipsised when the rectangle is narrow. */
  path: string;
  /** Amount of code in the boundary. Drives the rectangle's AREA, nothing else. */
  weight: number;
  /** Lease mode declared over the boundary. Omit for a boundary nobody has leased. */
  mode?: LeaseMode | undefined;
  /** `id`s of the members holding it. One for `I`/`X`/`G`; several for a shared `R`. */
  ownerIds?: readonly string[] | undefined;
  /** The state line, e.g. «TTL через 27 с», «в fast lane», «14.2k строк». */
  state?: string | undefined;
  /** Status colour of the state line. Text is a permitted status role. */
  stateTone?: OwnershipMapTone | undefined;
  /**
   * Status the REMAINING outline carries — amber while a lease heads to its TTL, red for an
   * incident. Defaults to `stateTone`, but only when that is `warning` or `danger`: a healthy
   * boundary says so in text and does not need a ring around it.
   */
  outlineTone?: OwnershipMapTone | undefined;
  /** Age of the lease, for the «Возраст» colouring. */
  ageBucket?: OwnershipAgeBucket | undefined;
  /** Human age, e.g. «29 мин». Falls back to the bucket's own name. */
  ageLabel?: string | undefined;
  /** Hover card: what the holder is doing right now. Defaults to `state`. */
  activity?: string | undefined;
  /** Hover card: the claim the lease was taken under, e.g. `c-2291`. */
  claimId?: string | undefined;
  disabled?: boolean | undefined;
}

export interface OwnershipMapLabels {
  /** Eyebrow above the map. */
  title: string;
  /** The line that explains the encoding. */
  hint: string;
  /** Accessible name of the colour-by switch. */
  dimensionsLabel: string;
  /** Captions of the three switch segments. */
  dimensions: Record<OwnershipMapColorBy, string>;
  /** Human name of each mode, as the hover card spells it. */
  modeNames: Record<LeaseMode, string>;
  /** Human name of each age bucket, used when a row brings no `ageLabel`. */
  ageNames: Record<OwnershipAgeBucket, string>;
  /** Second line of an unleased rectangle. */
  free: string;
  /** Hover card row keys. */
  owner: string;
  mode: string;
  activity: string;
  claim: string;
  /** Footer of the hover card. */
  cardHint: string;
  /** Owner value when a boundary is shared for reading. */
  sharedOwners: string;
  /** Owner value when nobody holds the boundary. */
  noOwner: string;
}

export type OwnershipMapLabelsInput = Partial<
  Omit<OwnershipMapLabels, 'dimensions' | 'modeNames' | 'ageNames'>
> & {
  dimensions?: Partial<Record<OwnershipMapColorBy, string>> | undefined;
  modeNames?: Partial<Record<LeaseMode, string>> | undefined;
  ageNames?: Partial<Record<OwnershipAgeBucket, string>> | undefined;
};

/**
 * The hover card spells a mode in terms of the BOUNDARY («интерфейс границы»), because that is the
 * question the map answers. `LEASE_MODE_LABEL` stays the wording for the tree and for assistive
 * tech, where the mode is read without the boundary in front of it.
 */
export const OWNERSHIP_MODE_NAME: Record<LeaseMode, string> = {
  read: 'общее чтение',
  impl: 'реализация границы',
  interface: 'интерфейс границы',
  guarded: 'охраняемый путь',
};

export const OWNERSHIP_MAP_LABELS: OwnershipMapLabels = {
  title: 'Карта владения',
  hint: 'площадь — объём кода · кромка и аватар — владелец',
  dimensionsLabel: 'Чем красить карту',
  dimensions: {
    owners: 'Владельцы',
    modes: 'Режимы',
    age: 'Возраст',
  },
  modeNames: OWNERSHIP_MODE_NAME,
  ageNames: {
    fresh: 'только взят',
    recent: 'недавний',
    aging: 'стареет',
    stale: 'давний',
  },
  free: 'свободно',
  owner: 'владелец',
  mode: 'режим',
  activity: 'активность',
  claim: 'claim',
  cardHint: 'наведение · клик открывает панель lease',
  sharedOwners: 'общее чтение',
  noOwner: 'никто',
};

function mergeLabels(input?: OwnershipMapLabelsInput): OwnershipMapLabels {
  if (!input) return OWNERSHIP_MAP_LABELS;
  return {
    ...OWNERSHIP_MAP_LABELS,
    ...input,
    dimensions: { ...OWNERSHIP_MAP_LABELS.dimensions, ...input.dimensions },
    modeNames: { ...OWNERSHIP_MAP_LABELS.modeNames, ...input.modeNames },
    ageNames: { ...OWNERSHIP_MAP_LABELS.ageNames, ...input.ageNames },
  };
}

/** What the panel shows instead of the map when it has nothing to draw. */
export interface OwnershipMapError {
  title?: string | undefined;
  description?: ReactNode | undefined;
  detail?: string | undefined;
  onRetry?: (() => void) | undefined;
}

export interface OwnershipMapProps {
  /** Boundaries, in display order. The map never re-sorts — the caller owns the reading order. */
  rows: readonly OwnershipMapRow[];
  /** Everyone who can appear as an owner. `ownerIds` are resolved against this list. */
  members: readonly Member[];
  identitySet?: IdentitySetName | undefined;
  /** Controlled colouring. Leave out and the map keeps its own. */
  colorBy?: OwnershipMapColorBy | undefined;
  defaultColorBy?: OwnershipMapColorBy | undefined;
  onColorByChange?: ((next: OwnershipMapColorBy) => void) | undefined;
  /** The segmented switch above the map. Off leaves the map on `colorBy` alone. */
  showDimensions?: boolean | undefined;
  /** Header with the eyebrow and the encoding hint. */
  showHeader?: boolean | undefined;
  /** Roughly how many rectangles a line should hold before the map wraps to a new one. */
  rowsPerLine?: number | undefined;
  selectedId?: string | undefined;
  /** Click or Enter on a rectangle — the design opens the lease panel. */
  onSelect?: ((row: OwnershipMapRow) => void) | undefined;
  /** Hover card. Off gives a plain map for a screenshot or a print view. */
  showCard?: boolean | undefined;
  loading?: boolean | undefined;
  loadingCaption?: ReactNode | undefined;
  error?: OwnershipMapError | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: ReactNode | undefined;
  emptyActions?: StateAction[] | undefined;
  labels?: OwnershipMapLabelsInput | undefined;
  className?: string | undefined;
}

/** A rectangle is at least this wide in weight terms, so a tiny boundary still has a hit area. */
function weightOf(row: OwnershipMapRow): number {
  return Number.isFinite(row.weight) && row.weight > 0 ? row.weight : 1;
}

export interface OwnershipMapLine {
  /** Sum of the weights on this line. Becomes the line's height share. */
  weight: number;
  rows: readonly OwnershipMapRow[];
}

/**
 * Deterministic treemap-ish packing, no library and no randomness.
 *
 * Rows are cut into lines in the order they arrive, each line taking about an equal SHARE OF THE
 * CODE (not an equal number of boxes). A line's height is then proportional to that share and a
 * box's width to its share of the line — which makes `area === weight` exactly, the one promise
 * the map makes. Given the design's own eight weights it reproduces the design's own two lines.
 */
export function packOwnershipLines(
  rows: readonly OwnershipMapRow[],
  rowsPerLine = 4,
): readonly OwnershipMapLine[] {
  if (rows.length === 0) return [];

  const perLine = Math.max(1, Math.floor(rowsPerLine));
  const lineCount = Math.max(1, Math.ceil(rows.length / perLine));
  const total = rows.reduce((sum, row) => sum + weightOf(row), 0);
  const target = total / lineCount;

  const lines: OwnershipMapLine[] = [];
  let current: OwnershipMapRow[] = [];
  let currentWeight = 0;

  rows.forEach((row, index) => {
    current.push(row);
    currentWeight += weightOf(row);

    // The last line is the remainder — closing it early would leave rows unplaced.
    if (lines.length === lineCount - 1) return;

    const rowsLeft = rows.length - index - 1;
    const linesLeft = lineCount - lines.length - 1;
    // Close on the weight target, or as soon as the rows left are exactly enough to give every
    // remaining line one box — an empty line would collapse to nothing.
    if (currentWeight >= target || rowsLeft <= linesLeft) {
      lines.push({ weight: currentWeight, rows: current });
      current = [];
      currentWeight = 0;
    }
  });

  if (current.length > 0) lines.push({ weight: currentWeight, rows: current });
  return lines;
}

/** `ownershipAreaStyle` takes an exact-optional bag, so build it instead of passing `undefined`. */
function areaOptions(
  set: IdentitySetName | undefined,
  tone: OwnershipMapTone | undefined,
): { set?: IdentitySetName; outlineStatus?: OwnershipMapTone } {
  const opts: { set?: IdentitySetName; outlineStatus?: OwnershipMapTone } = {};
  if (set) opts.set = set;
  if (tone) opts.outlineStatus = tone;
  return opts;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Ownership map — the whole repository as boundaries, sized by how much code each one holds.
 *
 * Three channels, three meanings, and they never trade places:
 * **area** = amount of code, **2px left edge + avatar** = the owner, **the remaining outline** =
 * state. The fill is whatever the switch above is currently colouring by — the owner's identity
 * area (role #4) under «Владельцы», and a neutral contrast ramp under «Режимы» and «Возраст»,
 * because a mode and an age belong to nobody and must not borrow a person's colour.
 */
export function OwnershipMap({
  rows,
  members,
  identitySet,
  colorBy,
  defaultColorBy = 'owners',
  onColorByChange,
  showDimensions = true,
  showHeader = true,
  rowsPerLine = 4,
  selectedId,
  onSelect,
  showCard = true,
  loading = false,
  loadingCaption,
  error,
  emptyTitle = 'Границы ещё не объявлены',
  emptyDescription,
  emptyActions,
  labels: labelsInput,
  className,
}: OwnershipMapProps): ReactElement {
  const labels = mergeLabels(labelsInput);
  const baseId = useId();

  const [selfColorBy, setSelfColorBy] = useState<OwnershipMapColorBy>(defaultColorBy);
  const activeColorBy = colorBy ?? selfColorBy;

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const dimensionRefs = useRef(new Map<OwnershipMapColorBy, HTMLButtonElement | null>());

  const memberById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const member of members) map.set(member.id, member);
    return map;
  }, [members]);

  const lines = useMemo(() => packOwnershipLines(rows, rowsPerLine), [rows, rowsPerLine]);

  const selectDimension = useCallback(
    (next: OwnershipMapColorBy) => {
      if (colorBy === undefined) setSelfColorBy(next);
      onColorByChange?.(next);
    },
    [colorBy, onColorByChange],
  );

  const stepDimension = useCallback(
    (direction: 1 | -1) => {
      const at = OWNERSHIP_MAP_COLOR_BY.indexOf(activeColorBy);
      const size = OWNERSHIP_MAP_COLOR_BY.length;
      const next = OWNERSHIP_MAP_COLOR_BY[(at + direction + size) % size];
      if (!next) return;
      selectDimension(next);
      dimensionRefs.current.get(next)?.focus();
    },
    [activeColorBy, selectDimension],
  );

  const onDimensionsKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          stepDimension(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          stepDimension(-1);
          break;
        default:
          break;
      }
    },
    [stepDimension],
  );

  const header = showHeader ? (
    <div className={styles.header}>
      <span className={styles.title}>{labels.title}</span>
      <span className={styles.hint}>{labels.hint}</span>
      {showDimensions ? (
        <div
          className={styles.dimensions}
          role="radiogroup"
          aria-label={labels.dimensionsLabel}
          onKeyDown={onDimensionsKeyDown}
        >
          {OWNERSHIP_MAP_COLOR_BY.map((dimension) => {
            const active = dimension === activeColorBy;
            return (
              <button
                key={dimension}
                ref={(node) => {
                  dimensionRefs.current.set(dimension, node);
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                className={styles.dimension}
                data-active={active || undefined}
                onClick={() => selectDimension(dimension)}
              >
                {labels.dimensions[dimension]}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  ) : null;

  let body: ReactElement;

  if (error) {
    body = (
      <ErrorState
        className={styles.state ?? ''}
        {...(error.title !== undefined ? { title: error.title } : {})}
        {...(error.description !== undefined ? { description: error.description } : {})}
        {...(error.detail !== undefined ? { detail: error.detail } : {})}
        {...(error.onRetry !== undefined ? { onRetry: error.onRetry } : {})}
      />
    );
  } else if (loading) {
    body = (
      <LoadingState
        className={styles.state ?? ''}
        rows={Math.max(3, Math.min(rows.length, 6))}
        {...(loadingCaption !== undefined ? { caption: loadingCaption } : {})}
      />
    );
  } else if (lines.length === 0) {
    body = (
      <EmptyState
        className={styles.state ?? ''}
        icon="worktree"
        title={emptyTitle}
        {...(emptyDescription !== undefined ? { description: emptyDescription } : {})}
        {...(emptyActions !== undefined ? { actions: emptyActions } : {})}
      />
    );
  } else {
    body = (
      <div
        className={styles.map}
        onMouseLeave={() => setHoveredId(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && hoveredId !== null) {
            event.stopPropagation();
            setHoveredId(null);
          }
        }}
      >
        {lines.map((line, lineIndex) => (
          <ul
            key={line.rows[0]?.id ?? lineIndex}
            className={styles.line}
            style={{ flexGrow: line.weight, flexBasis: 0 }}
          >
            {line.rows.map((row, cellIndex) => {
              const owners = (row.ownerIds ?? [])
                .map((id) => memberById.get(id))
                .filter((member): member is Member => member !== undefined);
              const soleOwner = owners.length === 1 ? owners[0] : undefined;
              const free = row.mode === undefined && owners.length === 0;

              const ageBucket = row.ageBucket;
              const tone =
                activeColorBy === 'age'
                  ? ageBucket
                    ? AGE_TONE[ageBucket]
                    : undefined
                  : activeColorBy === 'owners'
                    ? row.stateTone
                    : undefined;
              // The outline is state, whatever the fill is currently saying — a lease running out
              // does not stop running out because you switched the map to «Возраст». Only the two
              // attention tones escalate to the perimeter; success and running stay text.
              const outlineTone =
                row.outlineTone ??
                (row.stateTone === 'warning' || row.stateTone === 'danger'
                  ? row.stateTone
                  : undefined);

              let fill: 'identity' | 'neutral' | 'mode' | 'age' | 'free';
              let style: CSSProperties;

              if (free) {
                fill = 'free';
                style = freeAreaStyle();
              } else if (activeColorBy === 'owners' && soleOwner) {
                fill = 'identity';
                style = ownershipAreaStyle(
                  soleOwner.colorSlug,
                  areaOptions(identitySet, outlineTone),
                );
              } else {
                fill =
                  activeColorBy === 'modes' ? 'mode' : activeColorBy === 'age' ? 'age' : 'neutral';
                // Identity keeps its 2px left edge in every colouring — the owner does not stop
                // owning the boundary because the fill is answering another question.
                style = soleOwner ? zoneEdgeStyle(soleOwner.colorSlug, identitySet) : {};
              }

              const modeName = row.mode ? labels.modeNames[row.mode] : labels.free;
              const stateText = free
                ? (row.state ?? labels.free)
                : activeColorBy === 'modes'
                  ? modeName
                  : activeColorBy === 'age'
                    ? (row.ageLabel ?? (ageBucket ? labels.ageNames[ageBucket] : (row.state ?? '')))
                    : (row.state ?? '');

              const ownerNames =
                owners.length === 0
                  ? labels.noOwner
                  : owners.map((member) => member.name).join(', ');

              const cardId = `${baseId}-card-${row.id}`;
              const cardOpen = showCard && hoveredId === row.id;

              return (
                <li
                  key={row.id}
                  className={styles.cell}
                  style={{ flexGrow: weightOf(row), flexBasis: 0 }}
                >
                  <button
                    type="button"
                    className={styles.box}
                    style={style}
                    data-fill={fill}
                    data-mode={row.mode}
                    data-age={ageBucket}
                    data-outline={outlineTone}
                    data-edge={soleOwner ? 'true' : undefined}
                    data-selected={row.id === selectedId ? 'true' : undefined}
                    disabled={row.disabled}
                    aria-describedby={cardOpen ? cardId : undefined}
                    aria-label={`${row.path} · ${ownerNames} · ${modeName}${
                      stateText ? ` · ${stateText}` : ''
                    }`}
                    onMouseEnter={() => setHoveredId(row.id)}
                    onFocus={() => setHoveredId(row.id)}
                    onBlur={() => setHoveredId((current) => (current === row.id ? null : current))}
                    onClick={() => onSelect?.(row)}
                  >
                    <span className={styles.head}>
                      <span className={cx(styles.path, free && styles.pathFree)}>{row.path}</span>
                      {row.mode ? (
                        <span
                          className={styles.mode}
                          data-mode={row.mode}
                          style={
                            soleOwner && (row.mode === 'impl' || row.mode === 'interface')
                              ? avatarStyle(soleOwner.colorSlug, identitySet)
                              : undefined
                          }
                          aria-hidden="true"
                        >
                          {LEASE_MODE_BADGE[row.mode]}
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.foot}>
                      {owners.length > 0 ? (
                        <span className={styles.avatars}>
                          {owners.map((member) => (
                            <Avatar
                              key={member.id}
                              member={member}
                              size="xs"
                              identitySet={identitySet}
                              decorative
                            />
                          ))}
                        </span>
                      ) : null}
                      {stateText ? (
                        <span
                          className={cx(styles.stateLine, free && styles.stateFree)}
                          data-tone={tone}
                        >
                          {stateText}
                        </span>
                      ) : null}
                    </span>
                  </button>

                  {cardOpen ? (
                    <div
                      id={cardId}
                      role="tooltip"
                      className={styles.card}
                      data-flip-x={cellIndex > (line.rows.length - 1) / 2 ? 'true' : undefined}
                      data-flip-y={
                        lines.length > 1 && lineIndex === lines.length - 1 ? 'true' : undefined
                      }
                    >
                      <div className={styles.cardHead}>
                        {soleOwner ? (
                          <Avatar
                            member={soleOwner}
                            size="xs"
                            identitySet={identitySet}
                            decorative
                          />
                        ) : null}
                        <span className={styles.cardPath}>{row.path}</span>
                      </div>
                      <dl className={styles.cardRows}>
                        <div className={styles.cardRow}>
                          <dt className={styles.cardKey}>{labels.owner}</dt>
                          <dd className={styles.cardValue}>
                            {owners.length > 1 ? labels.sharedOwners : ownerNames}
                          </dd>
                        </div>
                        <div className={styles.cardRow}>
                          <dt className={styles.cardKey}>{labels.mode}</dt>
                          <dd className={styles.cardValue}>
                            {row.mode ? (
                              <>
                                <span
                                  className={styles.mode}
                                  data-mode={row.mode}
                                  style={
                                    soleOwner &&
                                    (row.mode === 'impl' || row.mode === 'interface')
                                      ? avatarStyle(soleOwner.colorSlug, identitySet)
                                      : undefined
                                  }
                                  title={LEASE_MODE_LABEL[row.mode]}
                                >
                                  {LEASE_MODE_BADGE[row.mode]}
                                </span>
                                <span className={styles.cardModeName}>{modeName}</span>
                              </>
                            ) : (
                              <span className={styles.cardModeName}>{labels.free}</span>
                            )}
                          </dd>
                        </div>
                        <div className={styles.cardRow}>
                          <dt className={styles.cardKey}>{labels.activity}</dt>
                          <dd className={styles.cardValue}>
                            <span className={styles.stateLine} data-tone={row.stateTone}>
                              {row.activity ?? row.state ?? labels.free}
                            </span>
                          </dd>
                        </div>
                        {row.claimId ? (
                          <div className={styles.cardRow}>
                            <dt className={styles.cardKey}>{labels.claim}</dt>
                            <dd className={styles.cardValue}>
                              <span className={styles.cardMono}>{row.claimId}</span>
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      <span className={styles.cardHint}>{labels.cardHint}</span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    );
  }

  return (
    <section className={cx(styles.root, className)} aria-label={labels.title}>
      {header}
      {body}
    </section>
  );
}
