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
import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, type Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import { Button } from '../Button/Button.tsx';
import {
  FileTreeRow,
  LEASE_MODE_BADGE,
  LEASE_MODE_LABEL,
  type FileTreeRowData,
  type LeaseMode,
} from '../FileTreeRow/FileTreeRow.tsx';
import s from './LeaseDetail.module.css';

/** One file inside the leased boundary. */
export interface LeaseDetailFile {
  id: string;
  /** Path as shown, relative to the boundary, e.g. `src/wallet.ts`. */
  path: string;
  /** Lines added in the holder's worktree. */
  added?: number | undefined;
  /** Lines removed in the holder's worktree. */
  removed?: number | undefined;
  /** Inside the boundary but never written to — the honest «не тронут» marker. */
  untouched?: boolean | undefined;
  /** Guarded path: writing to it needs an explicit unlock. Renders the `G` badge. */
  guarded?: boolean | undefined;
}

/** Tone of a history dot. Status colour as a dot — the permitted role. */
export type LeaseHistoryTone = 'success' | 'running' | 'warning' | 'danger' | 'neutral';

export interface LeaseHistoryEntry {
  id: string;
  /** What happened, e.g. «Взят · режим I, all-or-nothing». */
  title: ReactNode;
  /** The mechanical detail under it, e.g. «epoch 4 · вместе с G на index.ts». */
  detail?: ReactNode;
  tone?: LeaseHistoryTone | undefined;
}

export interface LeaseDetailData {
  /** Lease identifier as the hub knows it, e.g. `l-8841`. */
  id: string;
  /** Boundary the lease covers, e.g. `packages/economy`. */
  boundary: string;
  mode: LeaseMode;
  files: readonly LeaseDetailFile[];
  /** Right-hand summary of the file list, e.g. «4 файла · 14.2k строк». */
  filesSummary?: string | undefined;
  history: readonly LeaseHistoryEntry[];
}

export interface LeaseDetailLabels {
  filesTitle: string;
  historyTitle: string;
  extend: string;
  release: string;
  expandClaim: string;
  /** The tool name shown next to «Расширить claim». */
  expandClaimTool: string;
  /** Why `expand_claim` exists and what atomic means here. */
  expandClaimNote: string;
  requestHandoff: string;
  /** Trailing marker on a file nothing has been written to. */
  untouched: string;
  /** Prefix before the lease id in the header. */
  leaseIdPrefix: string;
  filesEmpty: string;
  historyEmpty: string;
  loading: string;
  retry: string;
  errorDescription: string;
  filesTreeLabel: string;
}

const DEFAULT_LABELS: LeaseDetailLabels = {
  filesTitle: 'Внутри границы',
  historyTitle: 'История lease',
  extend: 'Продлить',
  release: 'Отпустить',
  expandClaim: 'Расширить claim',
  expandClaimTool: 'expand_claim',
  expandClaimNote:
    'expand_claim — единственный законный способ захватить больше объявленного. Атомарно: не выйдет — прежние leases остаются, epoch не меняется.',
  requestHandoff: 'Запросить передачу',
  untouched: 'не тронут',
  leaseIdPrefix: 'lease',
  filesEmpty: 'Внутри границы пока пусто',
  historyEmpty: 'История пуста',
  loading: 'Загружаю lease…',
  retry: 'Повторить',
  errorDescription: 'Lease держится независимо от этой панели — он не пропал вместе с ней.',
  filesTreeLabel: 'Файлы внутри границы',
};

export interface LeaseDetailProps {
  lease: LeaseDetailData;
  /** Who holds it. Supplies the avatar and — for an exclusive mode — the mode badge fill. */
  owner: Member;
  identitySet?: IdentitySetName | undefined;
  /**
   * `true` (default) — my own lease: Продлить / Отпустить / expand_claim. `false` — somebody
   * else's: the same panel, no actions on their lease, one «Запросить передачу». Extending or
   * releasing a lease that is not yours is not a thing the protocol allows, so the buttons do not
   * exist rather than sit disabled.
   */
  own?: boolean | undefined;
  onExtend?: (() => void) | undefined;
  onRelease?: (() => void) | undefined;
  onExpandClaim?: (() => void) | undefined;
  /** Only reachable when `own` is false. */
  onRequestHandoff?: (() => void) | undefined;
  /** Open a file from the boundary list. */
  onOpenFile?: ((file: LeaseDetailFile) => void) | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  labels?: Partial<LeaseDetailLabels> | undefined;
  className?: string | undefined;
}

/**
 * The lease panel: what the boundary contains, what happened to the lease, and the three things
 * its holder may do about it.
 *
 * `expand_claim` is spelled out on purpose. Taking more than was declared is otherwise the natural
 * thing to try, and the footnote is where the product states that the widening is atomic — a
 * failure leaves every existing lease standing and the epoch untouched.
 */
export function LeaseDetail({
  lease,
  owner,
  identitySet,
  own = true,
  onExtend,
  onRelease,
  onExpandClaim,
  onRequestHandoff,
  onOpenFile,
  loading = false,
  error = null,
  onRetry,
  labels,
  className,
}: LeaseDetailProps): ReactElement {
  const text: LeaseDetailLabels = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);

  /**
   * The boundary contents reuse the tree row verbatim: the same identity edge, tint, diff counters
   * and `G` badge the workspace tree draws. A file carries the holder only when it has actually
   * been written to — an untouched or guarded path gets no ownership tint, exactly as designed.
   */
  const rows = useMemo<FileTreeRowData[]>(
    () =>
      lease.files.map((file) => {
        const touched = file.added != null || file.removed != null;
        const row: FileTreeRowData = {
          id: file.id,
          name: file.path,
          path: file.path,
          kind: 'file',
          depth: 0,
        };
        if (touched) row.ownerId = owner.id;
        if (file.added != null) row.added = file.added;
        if (file.removed != null) row.removed = file.removed;
        if (file.untouched) row.note = text.untouched;
        if (file.guarded) row.leaseMode = 'guarded';
        return row;
      }),
    [lease.files, owner.id, text.untouched],
  );

  const nodes = useRef(new Map<string, HTMLDivElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const rovingId =
    focusedId && rows.some((row) => row.id === focusedId) ? focusedId : rows[0]?.id ?? null;

  const focusAt = useCallback(
    (index: number): void => {
      const target = rows[Math.min(Math.max(index, 0), rows.length - 1)];
      if (!target) return;
      setFocusedId(target.id);
      nodes.current.get(target.id)?.focus();
    },
    [rows],
  );

  const handleKeyDown = useCallback(
    (index: number) =>
      (event: KeyboardEvent<HTMLDivElement>): void => {
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
            focusAt(rows.length - 1);
            break;
          default:
            break;
        }
      },
    [focusAt, rows.length],
  );

  const exclusive = lease.mode === 'impl' || lease.mode === 'interface';
  const modeStyle: CSSProperties | undefined = exclusive
    ? avatarStyle(owner.colorSlug, identitySet)
    : undefined;

  const hasOwnActions = own && Boolean(onExtend || onRelease || onExpandClaim);
  const hasForeignAction = !own && Boolean(onRequestHandoff);

  return (
    <section
      className={className ? `${s.panel} ${className}` : s.panel}
      aria-label={`${text.leaseIdPrefix} ${lease.id} · ${lease.boundary}`}
    >
      <header className={s.head}>
        <Avatar member={owner} size="xs" identitySet={identitySet} />
        <span className={s.boundary}>{lease.boundary}</span>
        <span
          className={s.mode}
          data-mode={lease.mode}
          style={modeStyle}
          role="img"
          aria-label={LEASE_MODE_LABEL[lease.mode]}
          title={LEASE_MODE_LABEL[lease.mode]}
        >
          {LEASE_MODE_BADGE[lease.mode]}
        </span>
        <span className={s.leaseId}>
          {text.leaseIdPrefix} {lease.id}
        </span>
      </header>

      {loading ? (
        <div className={s.body}>
          <LoadingState rows={5} label={text.loading} />
        </div>
      ) : error ? (
        <div className={s.body}>
          <ErrorState
            title={error}
            description={text.errorDescription}
            retryLabel={text.retry}
            {...(onRetry ? { onRetry } : {})}
          />
        </div>
      ) : (
        <>
          <div className={s.body}>
            <section className={s.block} aria-label={text.filesTitle}>
              <div className={s.blockHead}>
                <h4 className={s.blockTitle}>{text.filesTitle}</h4>
                {lease.filesSummary ? (
                  <span className={s.blockMeta}>{lease.filesSummary}</span>
                ) : null}
              </div>
              {rows.length === 0 ? (
                <EmptyState title={text.filesEmpty} icon="folder" />
              ) : (
                <div
                  className={s.files}
                  role="tree"
                  aria-label={text.filesTreeLabel}
                  aria-multiselectable="false"
                >
                  {rows.map((row, index) => (
                    <FileTreeRow
                      key={row.id}
                      ref={(el) => {
                        if (el) nodes.current.set(row.id, el);
                        else nodes.current.delete(row.id);
                      }}
                      row={row}
                      owner={row.ownerId ? owner : undefined}
                      identitySet={identitySet}
                      tabIndex={row.id === rovingId ? 0 : -1}
                      showOwnerChip={Boolean(row.ownerId)}
                      onKeyDown={handleKeyDown(index)}
                      {...(onOpenFile && lease.files[index]
                        ? {
                            onActivate: () => {
                              const file = lease.files[index];
                              if (file) onOpenFile(file);
                            },
                          }
                        : {})}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className={s.block} aria-label={text.historyTitle}>
              <h4 className={s.blockTitle}>{text.historyTitle}</h4>
              {lease.history.length === 0 ? (
                <EmptyState title={text.historyEmpty} icon="clock" />
              ) : (
                <ol className={s.timeline}>
                  {lease.history.map((entry, index) => (
                    <li key={entry.id} className={s.event}>
                      <span className={s.rail} aria-hidden="true">
                        <span className={s.dot} data-tone={entry.tone ?? 'neutral'} />
                        {index < lease.history.length - 1 ? (
                          <span className={s.line} />
                        ) : null}
                      </span>
                      <span className={s.eventBody}>
                        <span className={s.eventTitle}>{entry.title}</span>
                        {entry.detail ? (
                          <span className={s.eventDetail}>{entry.detail}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          {hasOwnActions || hasForeignAction ? (
            <footer className={s.footer}>
              <div className={s.actions}>
                {own ? (
                  <>
                    {onExtend ? (
                      <Button variant="secondary" size="sm" onClick={onExtend}>
                        {text.extend}
                      </Button>
                    ) : null}
                    {onRelease ? (
                      <Button variant="ghost" size="sm" className={s.quiet} onClick={onRelease}>
                        {text.release}
                      </Button>
                    ) : null}
                    {onExpandClaim ? (
                      <Button variant="secondary" size="sm" onClick={onExpandClaim}>
                        {text.expandClaim}
                        <span className={s.tool}>{text.expandClaimTool}</span>
                      </Button>
                    ) : null}
                  </>
                ) : onRequestHandoff ? (
                  <Button variant="secondary" size="sm" onClick={onRequestHandoff}>
                    {text.requestHandoff}
                  </Button>
                ) : null}
              </div>
              {own && onExpandClaim ? (
                <p className={s.note}>{text.expandClaimNote}</p>
              ) : null}
            </footer>
          ) : null}
        </>
      )}
    </section>
  );
}
