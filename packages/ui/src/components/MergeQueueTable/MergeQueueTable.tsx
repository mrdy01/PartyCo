import { useCallback, useId, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, zoneEdgeStyle, type Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Badge } from '../Badge/Badge.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { Skeleton } from '../Skeleton/Skeleton.tsx';
import { GateRejection } from '../GateRejection/GateRejection.tsx';
import { LEASE_MODE_BADGE, LEASE_MODE_LABEL } from '../FileTreeRow/FileTreeRow.tsx';
import {
  MERGE_LANE_BADGE,
  MERGE_LANE_LABEL,
  MERGE_LANE_STATUS,
  MERGE_QUEUE_STATE_LABEL,
  MERGE_QUEUE_STATE_STATUS,
  checkProgress,
  runningCheck,
  type MergeCheck,
  type MergeQueueRow,
} from './model.ts';
import styles from './MergeQueueTable.module.css';

/* ----------------------------------------------------------------- labels */

export interface MergeQueueLabels {
  /** Table caption — read by assistive tech, never painted. */
  caption: string;
  colPosition: string;
  colClaim: string;
  colAuthor: string;
  colBoundary: string;
  colDiff: string;
  colState: string;
  colLane: string;
  /** Disclosure button, closed state. Suffixed with the branch name. */
  expand: string;
  /** Disclosure button, open state. */
  collapse: string;
  /** Trailer the design adds to «ждёт» on the local user's own patch. */
  ownPatch: string;
  /** Accessible name of the check glyph that replaces the number on a merged row. */
  mergedMark: string;
  /** Reads the live progress bar aloud — the bar itself is a shape with no text. */
  progressLabel: (check: string) => string;
  empty: string;
  emptyHint: string;
  loading: string;
  errorTitle: string;
  errorRetry: string;
}

export type MergeQueueLabelsInput = Partial<MergeQueueLabels>;

/**
 * Every word this table says. The state, lane and gate wordings deliberately do **not** live here —
 * they come from `model.ts`, which the header, the lane diagram and the rejection card read too.
 * Restating them would let the five components on screen 2.4 drift apart.
 */
export const MERGE_QUEUE_LABELS: MergeQueueLabels = {
  caption: 'Очередь на влитие',
  colPosition: '#',
  colClaim: 'Claim',
  colAuthor: 'Автор',
  colBoundary: 'Граница · режим',
  colDiff: 'Дифф',
  colState: 'Состояние',
  colLane: 'Полоса',
  expand: 'Показать отказ гейта',
  collapse: 'Скрыть отказ гейта',
  ownPatch: 'твой патч',
  mergedMark: 'влит',
  progressLabel: (check) => `Прогресс проверки ${check}`,
  empty: 'Очередь пуста',
  emptyHint: 'Вливать нечего — trunk свободен.',
  loading: 'Загружаем очередь…',
  errorTitle: 'Очередь недоступна',
  errorRetry: 'Повторить',
};

function mergeLabels(input?: MergeQueueLabelsInput): MergeQueueLabels {
  return input ? { ...MERGE_QUEUE_LABELS, ...input } : MERGE_QUEUE_LABELS;
}

/* ------------------------------------------------------------------ props */

export interface MergeQueueTableProps {
  rows: readonly MergeQueueRow[];
  /** Identity palette the authors' colour slugs belong to. */
  identitySet?: IdentitySetName | undefined;
  selectedId?: string | null | undefined;
  /** Selecting a row is what drives the patch panel next to the table. */
  onSelect?: ((row: MergeQueueRow) => void) | undefined;
  /** Controlled expansion. Leave out and the table keeps its own. */
  expandedIds?: readonly string[] | undefined;
  onToggleExpand?: ((row: MergeQueueRow, expanded: boolean) => void) | undefined;
  /** Runs a resolution step inside the expanded refusal. Without it the steps are read-only. */
  onRejectionAction?: ((row: MergeQueueRow, stepId: string) => void) | undefined;
  /** Opens a failed check's log from the expanded refusal. */
  onOpenCheckLog?: ((row: MergeQueueRow, check: MergeCheck) => void) | undefined;
  /** Opens a failed check's diff from the expanded refusal. */
  onOpenCheckDiff?: ((row: MergeQueueRow, check: MergeCheck) => void) | undefined;
  /** «все виды отказов» — drawn only when there is somewhere to go. */
  onMoreRejections?: (() => void) | undefined;
  loading?: boolean | undefined;
  /** Non-empty string switches the table into its error state. */
  error?: string | null | undefined;
  onReload?: (() => void) | undefined;
  /** How many skeleton rows to draw while loading. */
  skeletonRows?: number | undefined;
  labels?: MergeQueueLabelsInput | undefined;
  className?: string | undefined;
}

/* -------------------------------------------------------------- internals */

const COLUMN_COUNT = 7;

/**
 * The design prints just «Тимур» in the author column; the full name stays in the `title`. Local
 * because it is two lines of string handling, not a shared concept.
 */
function firstName(member: Member): string {
  return member.name.trim().split(/\s+/)[0] ?? member.name;
}

/**
 * The «Состояние» cell, one branch per state.
 *
 * Colour comes from `--state-color`, which the cell sets from `MERGE_QUEUE_STATE_STATUS` — so the
 * dot, the spinner, the bar and the text are all the *same* status colour and none of them is ever
 * a fill. `checking` reads its name, its bar and its counter from one `runningCheck` +
 * `checkProgress` pair: the design shows the bar and «96/312» side by side, and two sources would
 * eventually disagree.
 */
function stateContent(row: MergeQueueRow, t: MergeQueueLabels): ReactNode {
  const label = MERGE_QUEUE_STATE_LABEL[row.state];

  switch (row.state) {
    case 'waiting':
      return (
        <>
          <span className={styles.hollowDot} aria-hidden="true" />
          <span className={styles.stateText}>
            {row.own ? `${label} · ${t.ownPatch}` : label}
          </span>
          {row.stateNote ? <span className={styles.stateNote}>{row.stateNote}</span> : null}
        </>
      );

    case 'fast-passed':
      return (
        <>
          <Icon name="check" className={styles.stateGlyph} />
          <span className={styles.stateText}>{row.stateNote ?? label}</span>
        </>
      );

    case 'rebasing':
      return (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.stateStrong}>{label}</span>
          {row.stateNote ? <span className={styles.stateNote}>{row.stateNote}</span> : null}
        </>
      );

    case 'checking': {
      const check = runningCheck(row);
      const progress = check ? checkProgress(check) : null;
      return (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.stateStrong}>{check ? check.label : label}</span>
          {check && progress ? (
            <>
              <span
                className={styles.bar}
                role="progressbar"
                aria-label={t.progressLabel(check.label)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.pct}
                aria-valuetext={progress.label}
              >
                {/* The only JS-computed value on the row besides the identity colour. */}
                <span className={styles.barFill} style={{ width: `${progress.pct}%` }} />
              </span>
              <span className={styles.progressCount}>{progress.label}</span>
            </>
          ) : null}
        </>
      );
    }

    case 'merging':
      return (
        <>
          <span className={styles.dot} data-pulse="true" aria-hidden="true" />
          <span className={styles.stateStrong}>{label}</span>
        </>
      );

    case 'merged':
      return (
        <>
          <span className={styles.stateStrong}>
            {label}
            {row.mergedSha ? (
              <>
                {' · '}
                <span className={styles.sha}>{row.mergedSha}</span>
              </>
            ) : null}
          </span>
          {row.stateNote ? <span className={styles.stateNote}>{row.stateNote}</span> : null}
        </>
      );

    case 'rejected': {
      // Relative age, never a clock time — «2 мин назад» is what the row is allowed to say.
      const ago = row.rejectedAgo ?? row.stateNote;
      return (
        <>
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.stateStrong}>{label}</span>
          {ago ? <span className={styles.stateNote}>{ago}</span> : null}
        </>
      );
    }

    default:
      return <span className={styles.stateText}>{label}</span>;
  }
}

/* -------------------------------------------------------------- the table */

/**
 * The merge queue, one patch per row.
 *
 * Four things the designer asked for and the old flat table could not say:
 *
 * 1. **«Полоса» is its own column.** "Which checks are running on me" and "what is happening to me"
 *    are different questions — a patch can be waiting *and* already through fast lane.
 * 2. **Progress is per check**, not one shared spinner: the row names the check that is actually in
 *    flight and draws its bar.
 * 3. **A refused row opens** into the gate refusal itself (`GateRejection variant="inline"`), so the
 *    explanation lands where the refusal was read.
 * 4. **The lease mode rides next to the boundary**, because «граница» without the mode does not say
 *    whether the patch was allowed to touch it.
 *
 * Colour discipline (CONVENTIONS §5). The 2px left edge is the author's identity colour in **every**
 * state, refusal included — it is applied inline through `zoneEdgeStyle` and continues onto the
 * expanded row. Status colour lives on the rest of the perimeter (an inset outline), on a tint of at
 * most 13%, and on the dot / bar / text — never as the left edge and never as a large fill.
 *
 * Trunk health is *not* here any more: it is the screen header now (`TrunkHealth`). A queue table
 * that also judged the trunk made the same fact appear twice on one screen.
 */
export function MergeQueueTable({
  rows,
  identitySet,
  selectedId = null,
  onSelect,
  expandedIds,
  onToggleExpand,
  onRejectionAction,
  onOpenCheckLog,
  onOpenCheckDiff,
  onMoreRejections,
  loading = false,
  error = null,
  onReload,
  skeletonRows = 4,
  labels: labelsInput,
  className,
}: MergeQueueTableProps): ReactElement {
  const t = mergeLabels(labelsInput);
  const scope = useId();
  const [ownExpanded, setOwnExpanded] = useState<readonly string[]>([]);
  const expanded = expandedIds ?? ownExpanded;

  const toggle = useCallback(
    (row: MergeQueueRow) => {
      const isOpen = expanded.includes(row.id);
      if (!expandedIds) {
        setOwnExpanded(isOpen ? expanded.filter((id) => id !== row.id) : [...expanded, row.id]);
      }
      onToggleExpand?.(row, !isOpen);
      onSelect?.(row);
    },
    [expanded, expandedIds, onToggleExpand, onSelect],
  );

  const columns = [
    t.colPosition,
    t.colClaim,
    t.colAuthor,
    t.colBoundary,
    t.colDiff,
    t.colState,
    t.colLane,
  ];

  const renderRow = (row: MergeQueueRow): ReactElement => {
    const rejection = row.rejection;
    // Only a row that has a refusal to show can be open — an id left in `expandedIds` after the
    // patch was re-queued must not silently swallow the row's bottom border.
    const isOpen = Boolean(rejection) && expanded.includes(row.id);
    const isSelected = selectedId === row.id;
    const detailId = `${scope}-${row.id}`;
    const edge = zoneEdgeStyle(row.author.colorSlug, identitySet);
    // An exclusive or shared-read mode badge is the author's claim on the boundary — identity
    // fill. `guarded` belongs to the rule rather than to a person, so it takes the warning tint.
    const modeStyle: CSSProperties | undefined =
      row.leaseMode === 'guarded' ? undefined : avatarStyle(row.author.colorSlug, identitySet);
    const modeLabel = LEASE_MODE_LABEL[row.leaseMode];
    const laneLabel = MERGE_LANE_LABEL[row.lane];

    const claimBody = (
      <>
        <span className={styles.branch}>{row.branch}</span>
        <span className={styles.claimNote}>{`${row.claimId} · ${row.claimTitle}`}</span>
      </>
    );

    return (
      <tbody className={styles.group} key={row.id} data-state={row.state}>
        <tr
          className={styles.row}
          /* Drives the hover highlight: the row lights up only where the click lands somewhere. */
          data-interactive={onSelect ? 'true' : undefined}
          data-selected={isSelected ? 'true' : undefined}
          data-open={isOpen ? 'true' : undefined}
          aria-current={isSelected ? true : undefined}
          onClick={onSelect ? () => onSelect(row) : undefined}
        >
          <td className={styles.cellPosition} style={edge}>
            <span className={styles.positionInner}>
              {rejection ? (
                <button
                  type="button"
                  className={styles.disclosure}
                  aria-expanded={isOpen}
                  aria-controls={detailId}
                  aria-label={`${isOpen ? t.collapse : t.expand}: ${row.branch}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(row);
                  }}
                >
                  <Icon name="caret-down" className={styles.caret} />
                </button>
              ) : null}
              {row.state === 'merged' ? (
                <>
                  <Icon name="check" className={styles.mergedMark} label={t.mergedMark} />
                  <span className={styles.srOnly}>{row.position}</span>
                </>
              ) : (
                <span className={styles.position}>{row.position}</span>
              )}
            </span>
          </td>

          <td className={styles.cellClaim}>
            {onSelect ? (
              <button
                type="button"
                className={`${styles.claim} ${styles.claimButton}`}
                title={`${row.branch} · ${row.claimId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(row);
                }}
              >
                {claimBody}
              </button>
            ) : (
              <span className={styles.claim} title={`${row.branch} · ${row.claimId}`}>
                {claimBody}
              </span>
            )}
          </td>

          <td className={styles.cellAuthor}>
            <span className={styles.author} title={row.author.name}>
              <Avatar member={row.author} size="xs" identitySet={identitySet} decorative />
              <span className={styles.authorName}>{firstName(row.author)}</span>
            </span>
          </td>

          <td className={styles.cellBoundary}>
            <span className={styles.boundary}>
              <span className={styles.path} title={row.boundary}>
                {row.boundary}
              </span>
              <span
                className={styles.mode}
                data-mode={row.leaseMode}
                style={modeStyle}
                role="img"
                aria-label={modeLabel}
                title={modeLabel}
              >
                {LEASE_MODE_BADGE[row.leaseMode]}
              </span>
            </span>
          </td>

          <td className={styles.cellDiff}>
            <span className={styles.diff}>
              <span className={styles.added}>{`+${row.diff.added}`}</span>
              <span className={styles.removed}>{`−${row.diff.removed}`}</span>
            </span>
          </td>

          <td className={styles.cellState} data-status={MERGE_QUEUE_STATE_STATUS[row.state]}>
            <span className={styles.stateInner}>{stateContent(row, t)}</span>
          </td>

          <td className={styles.cellLane}>
            <Badge
              status={MERGE_LANE_STATUS[row.lane]}
              mono
              dot={false}
              className={styles.lane}
              role="img"
              aria-label={laneLabel}
              title={laneLabel}
            >
              {MERGE_LANE_BADGE[row.lane]}
            </Badge>
          </td>
        </tr>

        {isOpen && rejection ? (
          <tr className={styles.detailRow} id={detailId}>
            {/* The author keeps the left edge here too — that is the whole point of the rule. */}
            <td className={styles.detailCell} colSpan={COLUMN_COUNT} style={edge}>
              <GateRejection
                variant="inline"
                rejection={rejection}
                author={row.author}
                branch={row.branch}
                identitySet={identitySet}
                onAction={
                  onRejectionAction ? (stepId: string) => onRejectionAction(row, stepId) : undefined
                }
                onOpenLog={
                  onOpenCheckLog ? (check: MergeCheck) => onOpenCheckLog(row, check) : undefined
                }
                onOpenDiff={
                  onOpenCheckDiff ? (check: MergeCheck) => onOpenCheckDiff(row, check) : undefined
                }
                onMore={onMoreRejections}
              />
            </td>
          </tr>
        ) : null}
      </tbody>
    );
  };

  const renderBody = (): ReactNode => {
    if (error) {
      return (
        <tbody>
          <tr>
            <td className={styles.stateCell} colSpan={COLUMN_COUNT}>
              <ErrorState
                title={t.errorTitle}
                description={error}
                retryLabel={t.errorRetry}
                icon="incident"
                {...(onReload ? { onRetry: onReload } : null)}
              />
            </td>
          </tr>
        </tbody>
      );
    }

    if (loading) {
      // Real <tr>s rather than a block placeholder: the colgroup keeps the skeleton on exactly the
      // column grid the rows will land on, so nothing jumps sideways when data arrives.
      return (
        <tbody className={styles.group}>
          {Array.from({ length: Math.max(1, skeletonRows) }, (_, index) => (
            <tr className={styles.row} key={`skeleton-${index}`} data-skeleton="true">
              <td className={styles.cellPosition}>
                <Skeleton width="2ch" />
              </td>
              <td className={styles.cellClaim}>
                <span className={styles.claim}>
                  <Skeleton width="58%" />
                  <Skeleton width="86%" />
                </span>
              </td>
              <td className={styles.cellAuthor}>
                <span className={styles.author}>
                  <Skeleton variant="block" />
                  <Skeleton width="60%" />
                </span>
              </td>
              <td className={styles.cellBoundary}>
                <Skeleton width="82%" />
              </td>
              <td className={styles.cellDiff}>
                <Skeleton width="72%" />
              </td>
              <td className={styles.cellState}>
                <Skeleton width="76%" />
              </td>
              <td className={styles.cellLane}>
                <Skeleton width="60%" />
              </td>
            </tr>
          ))}
        </tbody>
      );
    }

    if (rows.length === 0) {
      return (
        <tbody>
          <tr>
            <td className={styles.stateCell} colSpan={COLUMN_COUNT}>
              <EmptyState title={t.empty} description={t.emptyHint} icon="merge" />
            </td>
          </tr>
        </tbody>
      );
    }

    return rows.map(renderRow);
  };

  return (
    <div
      className={className ? `${styles.root} ${className}` : styles.root}
      aria-busy={loading || undefined}
    >
      <table className={styles.table}>
        <caption className={styles.srOnly}>
          {loading ? `${t.caption}. ${t.loading}` : t.caption}
        </caption>
        <colgroup>
          <col className={styles.colPosition} />
          <col className={styles.colClaim} />
          <col className={styles.colAuthor} />
          <col className={styles.colBoundary} />
          <col className={styles.colDiff} />
          <col className={styles.colState} />
          <col className={styles.colLane} />
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
      </table>
    </div>
  );
}
