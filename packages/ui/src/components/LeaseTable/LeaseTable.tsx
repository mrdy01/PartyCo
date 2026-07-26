import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, identityGutterVar, zoneEdgeStyle, type Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, type ButtonVariant } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { leaseWord } from '../StatusBar/StatusBar.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import { LEASE_MODE_BADGE, LEASE_MODE_LABEL, type LeaseMode } from '../FileTreeRow/FileTreeRow.tsx';
import styles from './LeaseTable.module.css';

/* ------------------------------------------------------------------ model */

/**
 * The visual states a live lease row can be in. Five of them are the design's own row variants;
 * `incident` is the sixth, drawn in the design as «инцидент #14 · запись без непрерывного lease» and
 * counted by the state grouping into «Требует человека · 2» — without it that count cannot be
 * reproduced.
 *
 * - `calm` — nothing animates, nothing is asked of anybody;
 * - `ttl` — heading to expiry by inactivity, with a countdown and «Запросить»;
 * - `reclaim` — the reclaim window after an incident: the loudest row on the screen;
 * - `stale-base` — the base fell behind trunk. A warning, not an error: the lease still holds;
 * - `fast-lane` — the boundary is in the merge fast lane and will free itself;
 * - `incident` — a rule was broken and a human has to look.
 */
export type LeaseRowState = 'calm' | 'ttl' | 'reclaim' | 'stale-base' | 'fast-lane' | 'incident';

/** The three buckets the «по состоянию» grouping sorts rows into. */
export type LeaseStateGroup = 'attention' | 'warning' | 'calm';

export type LeaseGrouping = 'owner' | 'state';

/** Status semantics a cell may carry. Confined to dot / pill / text / outline roles (§5). */
export type LeaseTone = 'neutral' | 'success' | 'warning' | 'danger' | 'running';

/**
 * Which bucket each row state belongs to. `ttl` sits with «Требует человека» on purpose: a lease
 * about to drop by inactivity is a decision waiting for a person, exactly like an incident — that
 * is how the design counts the group («Требует человека · 2» with one of reclaim/TTL live).
 */
export const LEASE_STATE_GROUP: Record<LeaseRowState, LeaseStateGroup> = {
  incident: 'attention',
  reclaim: 'attention',
  ttl: 'attention',
  'stale-base': 'warning',
  calm: 'calm',
  'fast-lane': 'calm',
};

/** Default status colour per row state. A row may override it with `stateTone`. */
export const LEASE_STATE_TONE: Record<LeaseRowState, LeaseTone> = {
  calm: 'success',
  ttl: 'warning',
  reclaim: 'warning',
  'stale-base': 'warning',
  'fast-lane': 'running',
  incident: 'danger',
};

/**
 * One button in the row's action cell. Data, not JSX, so the row stays serialisable and every
 * action arrives back through a single `onAction` handler.
 */
export interface LeaseRowAction {
  id: string;
  label: string;
  /**
   * `default` — ordinary control; `quiet` — the ghost secondary («Отпустить»); `reclaim` — the
   * amber "take it" control; `incident` — the red «Открыть».
   */
  tone?: 'default' | 'quiet' | 'reclaim' | 'incident' | undefined;
  disabled?: boolean | undefined;
  icon?: IconName | undefined;
}

export interface LeaseRow {
  id: string;
  /** Boundary the lease is held on, e.g. `packages/economy`. */
  boundary: string;
  /**
   * A guarded path *inside* the boundary above it. Indented and quieter, the way the design draws
   * «…/src/index.ts» under `packages/economy`.
   */
  nested?: boolean | undefined;
  /** Short label used by the collapsed chip row. Defaults to the last path segment. */
  shortLabel?: string | undefined;
  mode: LeaseMode;
  /** `id` of the member holding the lease. */
  ownerId: string;
  /** Claim identifier, e.g. `c-2288`. */
  claim: string;
  /** The lease id the reclaim copy promises the holder will come back on. */
  leaseId?: string | undefined;
  /** Activity cell, already humanised: «4 мин назад», «неактивна 29 мин». */
  activity: string;
  /** Warning tone on the activity cell — inactivity that is walking the lease towards TTL. */
  activityTone?: LeaseTone | undefined;
  state: LeaseRowState;
  /** State cell text. Falls back to the label for the state. */
  stateText?: string | undefined;
  /** Overrides the status colour derived from `state`. */
  stateTone?: LeaseTone | undefined;
  /** Glyph before the state text instead of the dot — a lock, a clock, an incident triangle. */
  stateIcon?: IconName | undefined;
  /** `strong` for the reclaim countdown, `muted` where the design keeps the text neutral. */
  emphasis?: 'muted' | 'normal' | 'strong' | undefined;
  /** Reclaim window countdown, e.g. «8:42». */
  reclaimLeft?: string | undefined;
  /** How much of the reclaim window is still left, 0…1. Drives the progress bar. */
  reclaimProgress?: number | undefined;
  /** Second line under the row. Defaults to the standard copy for `reclaim` / `stale-base`. */
  note?: ReactNode;
  /** Suppress the default second line without supplying one. */
  hideNote?: boolean | undefined;
  actions?: readonly LeaseRowAction[] | undefined;
  /** Non-actionable trailing text instead of buttons: «следует за X/I», «освободится сам». */
  actionNote?: string | undefined;
}

export interface GuardedPath {
  id: string;
  /** Path pattern, e.g. `db/migrations/**`. */
  path: string;
  /** Holder, if the path is currently leased. Absent renders the dashed «свободно» chip. */
  ownerId?: string | undefined;
}

/**
 * The guarded-path block that lives in the table footer rather than in a tab — the designer's
 * decision, so that «мой I на границе тянет G на её экспорт» reads without a navigation step.
 * The two shares are strings: they are product statistics, and this component must not round them.
 */
export interface GuardedPathsSummary {
  count: number;
  totalPaths: number;
  /** Share of all paths, pre-formatted: «0.23%». */
  sharePercent: string;
  /** Share of all gate rejections, pre-formatted: «61%». */
  gateRejectionPercent: string;
  /** Provenance line pinned to the right, e.g. «список закреплён в T0 bundle». */
  source?: string | undefined;
  paths: readonly GuardedPath[];
}

/* ----------------------------------------------------------------- labels */

export interface LeaseTableLabels {
  /** Read by assistive tech, not painted. */
  caption: string;
  title: string;
  groupBy: string;
  byOwner: string;
  byState: string;
  colBoundary: string;
  colMode: string;
  colOwner: string;
  colClaim: string;
  colActivity: string;
  colState: string;
  colActions: string;
  self: string;
  /** «1 lease» / «2 leases». */
  leaseCount: (count: number) => string;
  incidentSuffix: string;
  readSuffix: string;
  unknownOwner: string;
  stateGroup: Record<LeaseStateGroup, string>;
  attentionHint: string;
  calmHint: string;
  expandCalm: string;
  collapseCalm: string;
  state: Record<LeaseRowState, string>;
  reclaimWindow: (left: string) => string;
  reclaimProgressLabel: string;
  reclaimNote: (holder: string) => ReactNode;
  staleBaseNote: (holder: string) => ReactNode;
  guardedTitle: (count: number, totalPaths: number) => string;
  guardedStat: (sharePercent: string, gateRejectionPercent: string) => string;
  guardedExplanation: ReactNode;
  freePath: string;
  openRow: string;
  empty: string;
  emptyHint: string;
  loading: string;
  errorTitle: string;
  errorRetry: string;
}

export type LeaseTableLabelsInput = Partial<
  Omit<LeaseTableLabels, 'stateGroup' | 'state'>
> & {
  stateGroup?: Partial<Record<LeaseStateGroup, string>>;
  state?: Partial<Record<LeaseRowState, string>>;
};

const numberFormat = new Intl.NumberFormat('ru-RU');

/**
 * «1 lease» / «2 leases». Plurality comes from StatusBar's `leaseWord`, so the word is formed in
 * exactly one place: the bar and this table used to disagree with each other on the same screen.
 */
function leaseCountLabel(count: number): string {
  return `${count} ${leaseWord(count)}`;
}

export const LEASE_TABLE_LABELS: LeaseTableLabels = {
  caption: 'Активные leases',
  title: 'Активные leases',
  groupBy: 'группировать',
  byOwner: 'по владельцу',
  byState: 'по состоянию',
  colBoundary: 'Граница',
  colMode: 'Реж',
  colOwner: 'Владелец',
  colClaim: 'Claim',
  colActivity: 'Активность',
  colState: 'Состояние',
  colActions: 'Действия',
  self: 'это ты',
  leaseCount: leaseCountLabel,
  incidentSuffix: 'инцидент',
  readSuffix: 'общее чтение',
  unknownOwner: 'Без владельца',
  stateGroup: {
    attention: 'Требует человека',
    warning: 'Предупреждения',
    calm: 'Спокойные',
  },
  attentionHint: 'сверху всегда, независимо от владельца',
  calmHint: 'свёрнуто по умолчанию — они не требуют внимания',
  expandCalm: 'Развернуть спокойные leases',
  collapseCalm: 'Свернуть спокойные leases',
  state: {
    calm: 'активен',
    ttl: 'TTL по неактивности',
    reclaim: 'окно возврата',
    'stale-base': 'база отстала от trunk',
    'fast-lane': 'в fast lane',
    incident: 'инцидент',
  },
  reclaimWindow: (left) => `Окно возврата · ${left}`,
  reclaimProgressLabel: 'Осталось от окна возврата',
  reclaimNote: (holder) => (
    <>
      Объявлено всей команде. {holder} вернётся по тому же <code className={styles.code}>lease_id</code>{' '}
      — работа не потеряна. Если границу заберут, claim уйдёт в PARKED, а ветка сохранится.
    </>
  ),
  staleBaseNote: (holder) => (
    <>
      Предупреждение, не ошибка: lease держится, работа идёт. Но gate не пропустит патч по{' '}
      <code className={styles.code}>intervening_write</code>, если {holder} не подтянет trunk до
      отправки.
    </>
  ),
  guardedTitle: (count, totalPaths) =>
    `Guarded-пути · ${numberFormat.format(count)} из ${numberFormat.format(totalPaths)}`,
  guardedStat: (sharePercent, gateRejectionPercent) =>
    `${sharePercent} путей · ${gateRejectionPercent} всех отказов гейта за неделю`,
  guardedExplanation: (
    <>
      Почему отдельно: <code className={styles.code}>G</code> — единственный режим на{' '}
      <strong className={styles.strong}>путь</strong>, а не на границу, и он требует{' '}
      <strong className={styles.strong}>непрерывного</strong> удержания от начала авторства до
      отправки. Именно на нём ломается сценарий «lease истёк → кто-то отредактировал → я пере-захватил
      → я отправил»: гейт проигрывает историю <code className={styles.code}>lease_event</code> и не
      пропускает патч.
    </>
  ),
  freePath: 'свободно',
  openRow: 'Открыть lease',
  empty: 'Активных leases нет',
  emptyHint: 'Никто не держит ни одной границы — можно брать любую.',
  loading: 'Загружаем leases…',
  errorTitle: 'Leases недоступны',
  errorRetry: 'Повторить',
};

function mergeLabels(input?: LeaseTableLabelsInput): LeaseTableLabels {
  if (!input) return LEASE_TABLE_LABELS;
  return {
    ...LEASE_TABLE_LABELS,
    ...input,
    stateGroup: { ...LEASE_TABLE_LABELS.stateGroup, ...input.stateGroup },
    state: { ...LEASE_TABLE_LABELS.state, ...input.state },
  };
}

/* ------------------------------------------------------------------ props */

export interface LeaseTableProps {
  rows: readonly LeaseRow[];
  /** Every member a row or a guarded path can point at. Order drives the «по владельцу» groups. */
  members: readonly Member[];
  identitySet?: IdentitySetName | undefined;
  /** Controlled grouping. Leave out and the table keeps its own. */
  grouping?: LeaseGrouping | undefined;
  /** «по состоянию» by default — the designer's call, and the reason this screen is scannable. */
  defaultGrouping?: LeaseGrouping | undefined;
  onGroupingChange?: ((grouping: LeaseGrouping) => void) | undefined;
  /** Controlled collapse of the «Спокойные» group. */
  calmCollapsed?: boolean | undefined;
  defaultCalmCollapsed?: boolean | undefined;
  onCalmCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  selectedId?: string | null | undefined;
  /** Click or arrow-key focus + Space. Drives the lease panel next to the table. */
  onSelect?: ((row: LeaseRow) => void) | undefined;
  /** Enter on a focused row. */
  onOpen?: ((row: LeaseRow) => void) | undefined;
  onAction?: ((row: LeaseRow, actionId: string) => void) | undefined;
  /** Guarded-path footer. Omit to drop the footer entirely. */
  guarded?: GuardedPathsSummary | null | undefined;
  onGuardedPathClick?: ((path: GuardedPath) => void) | undefined;
  loading?: boolean | undefined;
  /** Non-empty string switches the table into its error state. */
  error?: string | null | undefined;
  onReload?: (() => void) | undefined;
  skeletonRows?: number | undefined;
  /**
   * Tint the local user's rows with their identity gutter, as the design does — the same role the
   * file tree already uses for an owned row.
   */
  tintOwnRows?: boolean | undefined;
  labels?: LeaseTableLabelsInput | undefined;
  className?: string | undefined;
}

/* -------------------------------------------------------------- internals */

const ACTION_VARIANT: Record<NonNullable<LeaseRowAction['tone']>, ButtonVariant> = {
  default: 'secondary',
  quiet: 'ghost',
  reclaim: 'warning',
  incident: 'danger',
};

const PULSING_STATES: ReadonlySet<LeaseRowState> = new Set<LeaseRowState>(['reclaim', 'fast-lane']);

const STATE_GROUP_ORDER: readonly LeaseStateGroup[] = ['attention', 'warning', 'calm'];

const STATE_GROUP_TONE: Record<LeaseStateGroup, LeaseTone> = {
  attention: 'danger',
  warning: 'warning',
  calm: 'success',
};

function firstName(member: Member): string {
  return member.name.trim().split(/\s+/)[0] ?? member.name;
}

function lastSegment(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

interface RenderGroup {
  key: string;
  member: Member | null;
  stateGroup: LeaseStateGroup | null;
  rows: LeaseRow[];
}

function groupByOwner(
  rows: readonly LeaseRow[],
  members: readonly Member[],
  unknownKey: string,
): RenderGroup[] {
  const groups: RenderGroup[] = [];
  for (const member of members) {
    const owned = rows.filter((row) => row.ownerId === member.id);
    if (owned.length > 0) groups.push({ key: member.id, member, stateGroup: null, rows: owned });
  }
  const known = new Set(members.map((member) => member.id));
  const orphans = rows.filter((row) => !known.has(row.ownerId));
  if (orphans.length > 0) {
    groups.push({ key: unknownKey, member: null, stateGroup: null, rows: orphans });
  }
  return groups;
}

function groupByState(rows: readonly LeaseRow[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  for (const bucket of STATE_GROUP_ORDER) {
    const inBucket = rows.filter((row) => LEASE_STATE_GROUP[row.state] === bucket);
    if (inBucket.length > 0) {
      groups.push({ key: bucket, member: null, stateGroup: bucket, rows: inBucket });
    }
  }
  return groups;
}

/* -------------------------------------------------------------- the table */

/**
 * The active-lease table. Two groupings — by owner and by state — over the same rows, five live row
 * states plus the incident row, and the guarded-path block in a real `<tfoot>`.
 *
 * Colour discipline (CONVENTIONS §5): identity colour appears as the 2px left edge of the boundary
 * cell, the avatar fill, the identity chip on an exclusive mode badge and the own-row gutter tint —
 * all through the `identity.ts` helpers. Status colour never becomes a large fill and never takes
 * the left edge: the reclaim row is made loud with a marching top border, a warning outline on the
 * rest of its perimeter, a pulsing dot and bold text, while its left edge stays the holder's.
 */
export function LeaseTable({
  rows,
  members,
  identitySet,
  grouping,
  defaultGrouping = 'state',
  onGroupingChange,
  calmCollapsed,
  defaultCalmCollapsed = true,
  onCalmCollapsedChange,
  selectedId = null,
  onSelect,
  onOpen,
  onAction,
  guarded = null,
  onGuardedPathClick,
  loading = false,
  error = null,
  onReload,
  skeletonRows = 5,
  tintOwnRows = true,
  labels: labelsInput,
  className,
}: LeaseTableProps): ReactElement {
  const labels = mergeLabels(labelsInput);
  const tableRef = useRef<HTMLTableElement>(null);

  const [ownGrouping, setOwnGrouping] = useState<LeaseGrouping>(defaultGrouping);
  const activeGrouping = grouping ?? ownGrouping;

  const [ownCalmCollapsed, setOwnCalmCollapsed] = useState<boolean>(defaultCalmCollapsed);
  const calmIsCollapsed = calmCollapsed ?? ownCalmCollapsed;

  const memberById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const member of members) map.set(member.id, member);
    return map;
  }, [members]);

  const groups = useMemo(
    () =>
      activeGrouping === 'owner'
        ? groupByOwner(rows, members, labels.unknownOwner)
        : groupByState(rows),
    [activeGrouping, rows, members, labels.unknownOwner],
  );

  const columns = [
    labels.colBoundary,
    labels.colMode,
    labels.colOwner,
    labels.colClaim,
    labels.colActivity,
    labels.colState,
    labels.colActions,
  ];
  const span = columns.length;

  const interactive = Boolean(onSelect || onOpen);

  /** Rows the user can actually reach right now — collapsed calm rows are chips, not rows. */
  const reachableRows = useMemo(() => {
    const list: LeaseRow[] = [];
    for (const group of groups) {
      if (group.stateGroup === 'calm' && calmIsCollapsed) continue;
      list.push(...group.rows);
    }
    return list;
  }, [groups, calmIsCollapsed]);

  const rovingId =
    selectedId && reachableRows.some((row) => row.id === selectedId)
      ? selectedId
      : (reachableRows[0]?.id ?? null);

  const changeGrouping = useCallback(
    (next: LeaseGrouping) => {
      if (!grouping) setOwnGrouping(next);
      onGroupingChange?.(next);
    },
    [grouping, onGroupingChange],
  );

  const toggleCalm = useCallback(() => {
    const next = !calmIsCollapsed;
    if (calmCollapsed === undefined) setOwnCalmCollapsed(next);
    onCalmCollapsedChange?.(next);
  }, [calmIsCollapsed, calmCollapsed, onCalmCollapsedChange]);

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>, row: LeaseRow): void => {
      // A key pressed on a button inside the row belongs to that button, not to the row.
      if (event.target !== event.currentTarget) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        onSelect?.(row);
        onOpen?.(row);
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        onSelect?.(row);
        return;
      }
      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return;
      }
      const root = tableRef.current;
      if (!root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLTableRowElement>('tr[data-lease-row="true"]'),
      );
      if (items.length === 0) return;
      const current = items.indexOf(event.currentTarget);
      let next = current;
      if (event.key === 'ArrowDown') next = Math.min(items.length - 1, current + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
      else if (event.key === 'Home') next = 0;
      else next = items.length - 1;
      const target = items[next];
      if (!target || target === event.currentTarget) return;
      event.preventDefault();
      target.focus();
    },
    [onOpen, onSelect],
  );

  const renderRow = (row: LeaseRow): ReactElement => {
    const owner = memberById.get(row.ownerId) ?? null;
    const tone = row.stateTone ?? LEASE_STATE_TONE[row.state];
    const selected = selectedId === row.id;
    const isReclaim = row.state === 'reclaim';

    const boundaryStyle = zoneEdgeStyle(owner ? owner.colorSlug : null, identitySet);
    const tint =
      tintOwnRows && owner?.isSelf === true && !selected
        ? { background: identityGutterVar(owner.colorSlug, identitySet) }
        : null;

    // An exclusive lease is the owner's claim, so its badge is a filled identity chip — the same
    // role and the same helper as the avatar. `read` / `guarded` belong to nobody.
    const modeStyle =
      owner && (row.mode === 'impl' || row.mode === 'interface')
        ? avatarStyle(owner.colorSlug, identitySet)
        : undefined;

    const note = row.hideNote
      ? null
      : (row.note ??
        (isReclaim && owner
          ? labels.reclaimNote(firstName(owner))
          : row.state === 'stale-base' && owner
            ? labels.staleBaseNote(firstName(owner))
            : null));

    const stateText =
      row.stateText ??
      (isReclaim && row.reclaimLeft
        ? labels.reclaimWindow(row.reclaimLeft)
        : labels.state[row.state]);

    const progress =
      isReclaim && row.reclaimProgress != null
        ? Math.min(1, Math.max(0, row.reclaimProgress))
        : null;

    return (
      <>
        {isReclaim ? (
          <tr className={styles.marchRow} aria-hidden="true">
            <td className={styles.marchCell} colSpan={span}>
              <span className={styles.march} />
            </td>
          </tr>
        ) : null}
        <tr
          className={styles.row}
          data-lease-row={interactive ? 'true' : undefined}
          data-state={row.state}
          data-selected={selected ? 'true' : undefined}
          data-note={note ? 'true' : undefined}
          aria-selected={interactive ? selected : undefined}
          tabIndex={interactive ? (rovingId === row.id ? 0 : -1) : undefined}
          onClick={interactive ? () => onSelect?.(row) : undefined}
          onKeyDown={interactive ? (event) => handleRowKeyDown(event, row) : undefined}
        >
          <th
            scope="row"
            className={styles.cellBoundary}
            style={tint ? { ...boundaryStyle, ...tint } : boundaryStyle}
            data-nested={row.nested ? 'true' : undefined}
            title={row.boundary}
          >
            <span className={styles.boundary}>{row.boundary}</span>
          </th>
          <td className={styles.cellMode} style={tint ?? undefined}>
            <span
              className={styles.mode}
              data-mode={row.mode}
              style={modeStyle}
              role="img"
              aria-label={LEASE_MODE_LABEL[row.mode]}
              title={LEASE_MODE_LABEL[row.mode]}
            >
              {LEASE_MODE_BADGE[row.mode]}
            </span>
          </td>
          <td className={styles.cellOwner} style={tint ?? undefined}>
            {owner ? (
              <span className={styles.owner}>
                <Avatar member={owner} size="xs" identitySet={identitySet} decorative />
                <span className={styles.ownerName}>{firstName(owner)}</span>
              </span>
            ) : (
              <span className={styles.muted}>{labels.unknownOwner}</span>
            )}
          </td>
          <td className={styles.cellClaim} style={tint ?? undefined}>
            {row.claim}
          </td>
          <td
            className={styles.cellActivity}
            data-tone={row.activityTone ?? 'neutral'}
            style={tint ?? undefined}
          >
            {row.activity}
          </td>
          <td
            className={styles.cellState}
            data-tone={tone}
            data-emphasis={row.emphasis ?? 'normal'}
            style={tint ?? undefined}
          >
            <span className={styles.state}>
              {row.stateIcon ? (
                <Icon name={row.stateIcon} size={12} className={styles.stateIcon} />
              ) : (
                <span
                  className={styles.dot}
                  data-pulse={PULSING_STATES.has(row.state) ? 'true' : undefined}
                  aria-hidden="true"
                />
              )}
              <span className={styles.stateText}>{stateText}</span>
              {progress != null ? (
                <span
                  className={styles.meter}
                  role="progressbar"
                  aria-label={labels.reclaimProgressLabel}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                >
                  <span className={styles.meterFill} style={{ width: `${progress * 100}%` }} />
                </span>
              ) : null}
            </span>
          </td>
          <td className={styles.cellActions} style={tint ?? undefined}>
            <span className={styles.actions}>
              {(row.actions ?? []).map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  variant={ACTION_VARIANT[action.tone ?? 'default']}
                  disabled={action.disabled ?? false}
                  {...(action.icon ? { icon: action.icon } : null)}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    onAction?.(row, action.id);
                  }}
                >
                  {action.label}
                </Button>
              ))}
              {row.actionNote ? (
                <span className={styles.actionNote}>{row.actionNote}</span>
              ) : null}
            </span>
          </td>
        </tr>
        {note ? (
          <tr className={styles.noteRow} data-state={row.state}>
            <td className={styles.noteCell} colSpan={span}>
              <p className={styles.note}>{note}</p>
            </td>
          </tr>
        ) : null}
      </>
    );
  };

  const renderOwnerHeader = (group: RenderGroup): ReactElement => {
    const member = group.member;
    const count = group.rows.length;
    const hasIncident = group.rows.some((row) => row.state === 'incident');
    const allRead = group.rows.every((row) => row.mode === 'read');
    const meta = [
      member?.isSelf === true ? labels.self : null,
      labels.leaseCount(count),
      hasIncident ? labels.incidentSuffix : null,
      !hasIncident && allRead ? labels.readSuffix : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' · ');

    return (
      <tr className={styles.groupRow}>
        <th scope="rowgroup" className={styles.groupCell} colSpan={span}>
          <span className={styles.groupInner}>
            {member ? (
              <Avatar member={member} size="xs" identitySet={identitySet} decorative />
            ) : null}
            <span className={styles.groupName}>{member ? member.name : labels.unknownOwner}</span>
            <span className={styles.groupMeta}>{meta}</span>
          </span>
        </th>
      </tr>
    );
  };

  const renderStateHeader = (group: RenderGroup, bucket: LeaseStateGroup): ReactElement => {
    const count = group.rows.length;
    const title = `${labels.stateGroup[bucket]} · ${count}`;
    const hint =
      bucket === 'attention' ? labels.attentionHint : bucket === 'calm' ? labels.calmHint : null;

    const inner = (
      <>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.groupTitle}>{title}</span>
        {hint ? <span className={styles.groupMeta}>{hint}</span> : null}
      </>
    );

    return (
      <tr className={styles.groupRow}>
        <th
          scope="rowgroup"
          className={styles.groupCell}
          data-tone={STATE_GROUP_TONE[bucket]}
          colSpan={span}
        >
          {bucket === 'calm' ? (
            <button
              type="button"
              className={styles.groupToggle}
              aria-expanded={!calmIsCollapsed}
              aria-label={calmIsCollapsed ? labels.expandCalm : labels.collapseCalm}
              onClick={toggleCalm}
            >
              {inner}
              <Icon
                name="chevron-right"
                size={11}
                className={`${styles.groupChevron} ${calmIsCollapsed ? '' : styles.groupChevronOpen}`}
              />
            </button>
          ) : (
            <span className={styles.groupInner}>{inner}</span>
          )}
        </th>
      </tr>
    );
  };

  const renderCalmChips = (group: RenderGroup): ReactElement => (
    <tr className={styles.chipsRow}>
      <td className={styles.chipsCell} colSpan={span}>
        <ul className={styles.chips}>
          {group.rows.map((row) => {
            const owner = memberById.get(row.ownerId) ?? null;
            const modeStyle =
              owner && (row.mode === 'impl' || row.mode === 'interface')
                ? avatarStyle(owner.colorSlug, identitySet)
                : undefined;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={styles.chip}
                  data-selected={selectedId === row.id ? 'true' : undefined}
                  title={row.boundary}
                  onClick={() => {
                    onSelect?.(row);
                  }}
                  onDoubleClick={() => {
                    onOpen?.(row);
                  }}
                >
                  {owner ? (
                    <Avatar member={owner} size="xs" identitySet={identitySet} decorative />
                  ) : null}
                  <span className={styles.chipPath}>{row.shortLabel ?? lastSegment(row.boundary)}</span>
                  <span
                    className={styles.chipMode}
                    data-mode={row.mode}
                    style={modeStyle}
                    role="img"
                    aria-label={LEASE_MODE_LABEL[row.mode]}
                  >
                    {LEASE_MODE_BADGE[row.mode]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </td>
    </tr>
  );

  const renderBody = (): ReactNode => {
    if (error) {
      return (
        <tbody>
          <tr>
            <td className={styles.stateCell} colSpan={span}>
              <ErrorState
                title={labels.errorTitle}
                description={error}
                retryLabel={labels.errorRetry}
                {...(onReload ? { onRetry: onReload } : null)}
              />
            </td>
          </tr>
        </tbody>
      );
    }

    if (loading) {
      return (
        <tbody>
          <tr>
            <td className={styles.stateCell} colSpan={span}>
              <LoadingState rows={Math.max(1, skeletonRows)} label={labels.loading} />
            </td>
          </tr>
        </tbody>
      );
    }

    if (rows.length === 0) {
      return (
        <tbody>
          <tr>
            <td className={styles.stateCell} colSpan={span}>
              <EmptyState title={labels.empty} description={labels.emptyHint} icon="lease" />
            </td>
          </tr>
        </tbody>
      );
    }

    return groups.map((group) => {
      const bucket = group.stateGroup;
      const collapsed = bucket === 'calm' && calmIsCollapsed;
      return (
        <tbody className={styles.group} key={group.key}>
          {bucket ? renderStateHeader(group, bucket) : renderOwnerHeader(group)}
          {collapsed
            ? renderCalmChips(group)
            : group.rows.map((row) => <Fragment key={row.id}>{renderRow(row)}</Fragment>)}
        </tbody>
      );
    });
  };

  return (
    <section
      className={className ? `${styles.panel} ${className}` : styles.panel}
      aria-busy={loading || undefined}
    >
      <header className={styles.header}>
        <span className={styles.eyebrow}>{`${labels.title} · ${rows.length}`}</span>
        <span className={styles.grouping}>
          <span className={styles.groupingLabel}>{labels.groupBy}</span>
          <span className={styles.segmented} role="group" aria-label={labels.groupBy}>
            <button
              type="button"
              className={styles.segment}
              aria-pressed={activeGrouping === 'owner'}
              onClick={() => changeGrouping('owner')}
            >
              {labels.byOwner}
            </button>
            <button
              type="button"
              className={styles.segment}
              aria-pressed={activeGrouping === 'state'}
              onClick={() => changeGrouping('state')}
            >
              {labels.byState}
            </button>
          </span>
        </span>
      </header>

      <div className={styles.scroll}>
        <table
          ref={tableRef}
          className={styles.table}
          role={interactive ? 'grid' : undefined}
          aria-rowcount={rows.length}
        >
          <caption className={styles.srOnly}>
            {loading ? `${labels.caption}. ${labels.loading}` : labels.caption}
          </caption>
          <colgroup>
            <col className={styles.colBoundary} />
            <col className={styles.colMode} />
            <col className={styles.colOwner} />
            <col className={styles.colClaim} />
            <col className={styles.colActivity} />
            <col className={styles.colState} />
            <col className={styles.colActions} />
          </colgroup>
          <thead className={styles.head}>
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={styles.headCell}
                  data-align={index === columns.length - 1 ? 'end' : undefined}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          {renderBody()}
          {guarded ? (
            <tfoot className={styles.foot}>
              <tr>
                <td className={styles.footCell} colSpan={span}>
                  <div className={styles.guarded}>
                    <div className={styles.guardedHead}>
                      <Icon name="lease" size={13} className={styles.guardedIcon} />
                      <span className={styles.guardedTitle}>
                        {labels.guardedTitle(guarded.count, guarded.totalPaths)}
                      </span>
                      <span className={styles.guardedStat}>
                        {labels.guardedStat(guarded.sharePercent, guarded.gateRejectionPercent)}
                      </span>
                      {guarded.source ? (
                        <span className={styles.guardedSource}>{guarded.source}</span>
                      ) : null}
                    </div>
                    <p className={styles.guardedBody}>{labels.guardedExplanation}</p>
                    <ul className={styles.chips}>
                      {guarded.paths.map((path) => {
                        const owner = path.ownerId
                          ? (memberById.get(path.ownerId) ?? null)
                          : null;
                        const body = (
                          <>
                            {owner ? (
                              <Avatar
                                member={owner}
                                size="xs"
                                identitySet={identitySet}
                                decorative
                              />
                            ) : null}
                            <span className={styles.chipPath} data-free={owner ? undefined : 'true'}>
                              {path.path}
                            </span>
                            {owner ? null : (
                              <span className={styles.chipFree}>{labels.freePath}</span>
                            )}
                          </>
                        );
                        return (
                          <li key={path.id}>
                            {onGuardedPathClick ? (
                              <button
                                type="button"
                                className={styles.chip}
                                data-free={owner ? undefined : 'true'}
                                onClick={() => onGuardedPathClick(path)}
                              >
                                {body}
                              </button>
                            ) : (
                              <span
                                className={styles.chip}
                                data-free={owner ? undefined : 'true'}
                                title={path.path}
                              >
                                {body}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
