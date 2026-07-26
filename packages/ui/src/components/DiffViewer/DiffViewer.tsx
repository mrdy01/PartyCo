import { useMemo, useState, type ReactElement } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { Icon } from '@partyco/icons';
import { avatarStyle, diffGutterStyle, initialsOf, type Member } from '../../identity.ts';
import styles from './DiffViewer.module.css';

/** A single physical line of a hunk. `oldNumber`/`newNumber` are absent on the side that lacks it. */
export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  oldNumber?: number | undefined;
  newNumber?: number | undefined;
  text: string;
}

export interface DiffComment {
  id: string;
  author: Member;
  /** Already-composed comment body. The viewer never formats or truncates it. */
  text: string;
  /** Pre-formatted relative time, e.g. «2м». Formatting is the caller's job. */
  time?: string | undefined;
}

export type DiffHunkStatus = 'pending' | 'accepted' | 'rejected';

export interface DiffHunk {
  id: string;
  /** The `@@ … @@` line, verbatim. */
  header: string;
  lines: DiffLine[];
  status?: DiffHunkStatus | undefined;
  comments?: DiffComment[] | undefined;
}

export interface DiffFile {
  id: string;
  path: string;
  /** Whose change this is. The gutter tint is this member's identity colour — identity role #3. */
  owner: Member;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export type DiffViewMode = 'unified' | 'split';

export interface DiffViewerLabels {
  region: string;
  filesGroup: string;
  modeGroup: string;
  unified: string;
  split: string;
  sideOld: string;
  sideNew: string;
  accept: string;
  reject: string;
  comment: string;
  accepted: string;
  rejected: string;
  empty: string;
  loading: string;
  errorTitle: string;
  retry: string;
}

const DEFAULT_LABELS: DiffViewerLabels = {
  region: 'Просмотр диффа',
  filesGroup: 'Файлы в диффе',
  modeGroup: 'Режим показа',
  unified: 'unified',
  split: 'split',
  sideOld: 'До',
  sideNew: 'После',
  accept: 'Принять',
  reject: 'Отклонить',
  comment: 'Обсудить',
  accepted: 'Принят',
  rejected: 'Отклонён',
  empty: 'Изменений нет',
  loading: 'Загружаем дифф…',
  errorTitle: 'Не удалось показать дифф',
  retry: 'Повторить',
};

export interface DiffViewerProps {
  /** Structured diff. The component never parses a patch string. */
  files: DiffFile[];
  /** Controlled selection; falls back to internal state (first file) when omitted. */
  selectedFileId?: string | undefined;
  onSelectFile?: ((fileId: string) => void) | undefined;
  /** Controlled view mode; falls back to internal state when omitted. */
  mode?: DiffViewMode | undefined;
  defaultMode?: DiffViewMode | undefined;
  onModeChange?: ((mode: DiffViewMode) => void) | undefined;
  onAcceptHunk?: ((fileId: string, hunkId: string) => void) | undefined;
  onRejectHunk?: ((fileId: string, hunkId: string) => void) | undefined;
  onCommentHunk?: ((fileId: string, hunkId: string) => void) | undefined;
  /**
   * Whether the per-file list is shown. `auto` (the default) hides it for a single-file diff, where
   * the header already carries path, owner and counts.
   */
  fileList?: 'auto' | 'always' | 'never' | undefined;
  /** Identity palette in use for this project. */
  identitySet?: IdentitySetName | undefined;
  loading?: boolean | undefined;
  /** Non-empty string switches the body to the error state. */
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  labels?: Partial<DiffViewerLabels> | undefined;
  className?: string | undefined;
}

interface SplitRow {
  left?: DiffLine | undefined;
  right?: DiffLine | undefined;
}

/**
 * Pairs a unified line list into two-sided rows: a run of deletions is zipped against the run of
 * additions that follows it, context lines appear on both sides.
 */
function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];

  const flush = (): void => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i += 1) rows.push({ left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };

  for (const line of lines) {
    if (line.kind === 'del') dels.push(line);
    else if (line.kind === 'add') adds.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

const SIGN: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '−' };

// `string | undefined` because the CSS-module type is an index signature and
// `noUncheckedIndexedAccess` is on; `className` accepts undefined anyway.
function lineClass(kind: DiffLine['kind']): string | undefined {
  if (kind === 'add') return styles.codeAdd;
  if (kind === 'del') return styles.codeDel;
  return styles.codeContext;
}

function Avatar({
  member,
  identitySet,
}: {
  member: Member;
  identitySet?: IdentitySetName | undefined;
}): ReactElement {
  return (
    <span
      className={styles.avatar}
      style={avatarStyle(member.colorSlug, identitySet)}
      title={member.name}
      aria-hidden
    >
      {initialsOf(member)}
    </span>
  );
}

export function DiffViewer({
  files,
  selectedFileId,
  onSelectFile,
  mode,
  defaultMode = 'unified',
  onModeChange,
  onAcceptHunk,
  onRejectHunk,
  onCommentHunk,
  fileList = 'auto',
  identitySet,
  loading = false,
  error = null,
  onRetry,
  labels,
  className,
}: DiffViewerProps): ReactElement {
  const t = labels ? { ...DEFAULT_LABELS, ...labels } : DEFAULT_LABELS;

  const [innerFileId, setInnerFileId] = useState<string | undefined>(undefined);
  const [innerMode, setInnerMode] = useState<DiffViewMode>(defaultMode);

  const activeMode = mode ?? innerMode;
  const activeFileId = selectedFileId ?? innerFileId ?? files[0]?.id;
  const file = files.find((f) => f.id === activeFileId) ?? files[0];

  const selectFile = (id: string): void => {
    if (selectedFileId === undefined) setInnerFileId(id);
    onSelectFile?.(id);
  };

  const setMode = (next: DiffViewMode): void => {
    if (mode === undefined) setInnerMode(next);
    onModeChange?.(next);
  };

  const gutterStyle = useMemo(
    () => (file ? diffGutterStyle(file.owner.colorSlug, identitySet) : undefined),
    [file, identitySet],
  );

  const columns = activeMode === 'split' ? 4 : 2;

  const renderGutter = (line: DiffLine | undefined, side: 'old' | 'new'): ReactElement => {
    const num = side === 'old' ? line?.oldNumber : line?.newNumber;
    return (
      <th scope="row" className={styles.gutter} style={gutterStyle}>
        {num ?? ''}
      </th>
    );
  };

  const renderCode = (line: DiffLine | undefined): ReactElement => (
    <td className={line ? lineClass(line.kind) : styles.codeFiller}>
      {line ? (
        <>
          <span className={styles.sign}>{SIGN[line.kind]}</span>
          {line.text}
        </>
      ) : null}
    </td>
  );

  const renderBody = (): ReactElement => {
    if (loading) {
      return (
        <div className={styles.state} role="status">
          <span className={styles.shimmer} aria-hidden />
          <span className={styles.shimmer} aria-hidden />
          <span className={styles.shimmer} aria-hidden />
          <span className={styles.stateText}>{t.loading}</span>
        </div>
      );
    }
    if (error) {
      return (
        <div className={styles.state} role="alert">
          <span className={styles.errorTitle}>
            <Icon name="incident" />
            {t.errorTitle}
          </span>
          <span className={styles.stateText}>{error}</span>
          {onRetry ? (
            <button type="button" className={styles.retry} onClick={onRetry}>
              {t.retry}
            </button>
          ) : null}
        </div>
      );
    }
    if (!file || file.hunks.length === 0) {
      return (
        <div className={styles.state}>
          <Icon name="diff" />
          <span className={styles.stateText}>{t.empty}</span>
        </div>
      );
    }

    return (
      <div className={styles.scroller}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>{file.path}</caption>
          {activeMode === 'split' ? (
            <thead>
              <tr>
                <td className={styles.headSpacer} />
                <th scope="col" className={styles.sideHead}>
                  {t.sideOld}
                </th>
                <td className={styles.headSpacer} />
                <th scope="col" className={styles.sideHead}>
                  {t.sideNew}
                </th>
              </tr>
            </thead>
          ) : null}
          {file.hunks.map((hunk) => {
            const status: DiffHunkStatus = hunk.status ?? 'pending';
            const resolved = status !== 'pending';
            return (
              <tbody key={hunk.id}>
                <tr className={styles.hunkHeadRow}>
                  <th scope="colgroup" colSpan={columns} className={styles.hunkHead}>
                    <span className={styles.hunkHeadInner}>
                      <span className={styles.hunkRange}>{hunk.header}</span>
                      {status === 'accepted' ? (
                        <span className={styles.pillAccepted}>{t.accepted}</span>
                      ) : null}
                      {status === 'rejected' ? (
                        <span className={styles.pillRejected}>{t.rejected}</span>
                      ) : null}
                      <span className={styles.hunkActions}>
                        <button
                          type="button"
                          className={styles.actionAccept}
                          disabled={resolved}
                          onClick={() => onAcceptHunk?.(file.id, hunk.id)}
                        >
                          <Icon name="check" />
                          {t.accept}
                        </button>
                        <button
                          type="button"
                          className={styles.actionReject}
                          disabled={resolved}
                          onClick={() => onRejectHunk?.(file.id, hunk.id)}
                        >
                          <Icon name="close" />
                          {t.reject}
                        </button>
                        <button
                          type="button"
                          className={styles.action}
                          onClick={() => onCommentHunk?.(file.id, hunk.id)}
                        >
                          {t.comment}
                        </button>
                      </span>
                    </span>
                  </th>
                </tr>

                {activeMode === 'unified'
                  ? hunk.lines.map((line, i) => (
                      <tr key={`${hunk.id}-${i}`} className={styles.lineRow}>
                        {renderGutter(line, line.kind === 'add' ? 'new' : 'old')}
                        {renderCode(line)}
                      </tr>
                    ))
                  : toSplitRows(hunk.lines).map((row, i) => (
                      <tr key={`${hunk.id}-${i}`} className={styles.lineRow}>
                        {renderGutter(row.left, 'old')}
                        {renderCode(row.left)}
                        {renderGutter(row.right, 'new')}
                        {renderCode(row.right)}
                      </tr>
                    ))}

                {(hunk.comments ?? []).map((comment) => (
                  <tr key={comment.id} className={styles.commentRow}>
                    <td colSpan={columns} className={styles.commentCell}>
                      <span className={styles.comment}>
                        <Avatar member={comment.author} identitySet={identitySet} />
                        <span className={styles.commentText}>{comment.text}</span>
                        {comment.time ? (
                          <span className={styles.commentTime}>{comment.time}</span>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    );
  };

  return (
    <section
      className={className ? `${styles.root} ${className}` : styles.root}
      aria-label={t.region}
    >
      {(fileList === 'always' || (fileList === 'auto' && files.length > 1)) && files.length > 0 ? (
        <nav className={styles.fileList} aria-label={t.filesGroup}>
          <ul className={styles.fileUl}>
            {files.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className={styles.fileButton}
                  aria-current={f.id === activeFileId ? 'true' : undefined}
                  onClick={() => selectFile(f.id)}
                >
                  <Avatar member={f.owner} identitySet={identitySet} />
                  <span className={styles.filePath}>{f.path}</span>
                  <span className={styles.added}>+{f.additions}</span>
                  <span className={styles.removed}>−{f.deletions}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <header className={styles.header}>
        {file ? (
          <>
            <Avatar member={file.owner} identitySet={identitySet} />
            <span className={styles.headerPath}>{file.path}</span>
            <span className={styles.added}>+{file.additions}</span>
            <span className={styles.removed}>−{file.deletions}</span>
          </>
        ) : (
          <span className={styles.headerPath}>{t.empty}</span>
        )}
        <span className={styles.modeGroup} role="group" aria-label={t.modeGroup}>
          <button
            type="button"
            className={styles.modeButton}
            aria-pressed={activeMode === 'unified'}
            onClick={() => setMode('unified')}
          >
            {t.unified}
          </button>
          <span className={styles.modeSep} aria-hidden>
            ·
          </span>
          <button
            type="button"
            className={styles.modeButton}
            aria-pressed={activeMode === 'split'}
            onClick={() => setMode('split')}
          >
            {t.split}
          </button>
        </span>
      </header>

      {renderBody()}
    </section>
  );
}
