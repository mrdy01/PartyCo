import { useMemo, type ReactElement, type ReactNode } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { diffGutterStyle } from '../../identity.ts';
import type { FileViewerModel } from '../AppShell/model.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { IconButton } from '../IconButton/IconButton.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import styles from './FileViewer.module.css';

/**
 * `empty` is "nobody has opened anything", which is the pane's resting state — this revision has no
 * tab strip, so a second file replaces the first rather than joining it.
 */
export type FileViewerState = 'ready' | 'empty' | 'loading' | 'error';

export interface FileViewerLabels {
  /** The diff toggle's label. */
  diff: string;
  /** Accessible name of the close button. */
  close: string;
  /** Accessible name of the scrollable code region. */
  code: string;
  emptyTitle: string;
  emptyBody: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
}

const DEFAULT_LABELS: FileViewerLabels = {
  diff: 'Дифф',
  close: 'Закрыть файл',
  code: 'Код файла',
  emptyTitle: 'Файл не открыт',
  emptyBody: 'Выбери файл в дереве слева — он откроется здесь, а разговор останется на месте.',
  loading: 'Собираем дифф — обычно это меньше секунды.',
  errorTitle: 'Не получилось показать файл',
  errorBody: 'Хаб не ответил. Твоя работа на месте — и правки, и зона. Это только просмотр.',
  retry: 'Попробовать снова',
};

/** Same undefined-safe merge as the tree uses; see the note there. */
function withLabels(patch?: Partial<FileViewerLabels>): FileViewerLabels {
  const out: FileViewerLabels = { ...DEFAULT_LABELS };
  if (!patch) return out;
  for (const key of Object.keys(patch) as (keyof FileViewerLabels)[]) {
    const value = patch[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export interface FileViewerProps {
  /** The open file. Absent → the pane renders its empty state and no header. */
  file?: FileViewerModel | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Defaults to `ready` with a file and `empty` without one. */
  state?: FileViewerState | undefined;
  /** Whether the added / removed lines are marked. Defaults to on, the way the design draws it. */
  diff?: boolean | undefined;
  /** Omit and the toggle is not rendered — a switch that switches nothing is a lie. */
  onToggleDiff?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  labels?: Partial<FileViewerLabels> | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * One open file, opened because a person asked for it.
 *
 * Not a fork of `EditorPane`: that one keeps the tab strip, the breadcrumb, the lease chip and the
 * «Стр 129, Кол 22 · миникарта выкл · TypeScript · UTF-8 · LF» footer, and it stays on the
 * workspace screen. Here the design took all of that away — what is left is the file's name, whose
 * zone it is, the code, and a way to close it.
 *
 * Everything coloured in it is one of the two sanctioned palettes: the zone owner's identity colour
 * (the 2px edge and the gutter wash, both through `diffGutterStyle`, plus the marker's avatar) and
 * the success / danger status colour on the changed lines.
 */
export function FileViewer({
  file,
  identitySet,
  state,
  diff = true,
  onToggleDiff,
  onClose,
  onRetry,
  labels,
  className,
}: FileViewerProps): ReactElement {
  const text = useMemo(() => withLabels(labels), [labels]);
  const effective: FileViewerState = state ?? (file ? 'ready' : 'empty');

  /**
   * Identity role #3. One element, not two: the helper already carries the owner's 2px edge, so a
   * separate strip in front of the gutter would draw the same edge twice.
   */
  const gutterStyle = file?.zone
    ? diffGutterStyle(file.zone.owner.colorSlug, identitySet)
    : undefined;

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
        <LoadingState
          rows={10}
          withGlyph={false}
          withMeta={false}
          label={text.loading}
          caption={text.loading}
        />
      </div>
    );
  } else if (effective === 'empty' || !file) {
    body = (
      <div className={styles.state}>
        <EmptyState title={text.emptyTitle} description={text.emptyBody} icon="file" />
      </div>
    );
  } else {
    body = (
      <div className={styles.body} data-diff={diff ? 'true' : undefined}>
        {/*
         * The gutter and the code scroll as ONE box. They used to be two — the numbers sat in an
         * `overflow: hidden` column while the code scrolled on its own, so the first flick of the
         * wheel put every number against the wrong line. The marker stays outside this box, which
         * is why it is a wrapper and not simply `overflow` moved one level up.
         */}
        <div className={styles.scroll} role="region" aria-label={text.code} tabIndex={0}>
          {/* Line numbers repeat the code's information, so they are hidden from assistive tech. */}
          <div className={styles.gutter} style={gutterStyle} aria-hidden="true">
            {file.lines.map((line) => (
              <span
                key={line.number}
                className={cx(
                  styles.num,
                  diff && line.change === 'added' && styles.numAdded,
                  diff && line.change === 'removed' && styles.numRemoved,
                )}
              >
                {line.number}
              </span>
            ))}
          </div>

          <pre className={styles.code} data-selectable="">
            <code className={styles.codeInner}>
              {file.lines.map((line) => (
                <span
                  key={line.number}
                  className={cx(
                    styles.line,
                    diff && line.change === 'added' && styles.lineAdded,
                    diff && line.change === 'removed' && styles.lineRemoved,
                  )}
                >
                  {line.text}
                </span>
              ))}
            </code>
          </pre>
        </div>

        {file.marker ? (
          <div className={styles.marker}>
            <Avatar member={file.marker.member} size="xs" identitySet={identitySet} decorative />
            <span className={styles.markerText}>{file.marker.text}</span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className={cx(styles.root, className)} aria-label={file ? file.name : text.emptyTitle}>
      {file ? (
        <header className={styles.head}>
          <Icon name="file" className={styles.headGlyph} />
          <span className={styles.name}>{file.name}</span>
          <span className={styles.dir}>{file.dir}</span>
          {file.zone ? (
            // Identity role #3 again — a wash and the owner's edge, never a solid identity fill.
            <span
              className={styles.zone}
              style={diffGutterStyle(file.zone.owner.colorSlug, identitySet)}
              title={file.zone.owner.name}
            >
              {file.zone.label}
            </span>
          ) : null}
          <span className={styles.headEnd}>
            {onToggleDiff ? (
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={diff}
                onClick={onToggleDiff}
                className={styles.diffToggle}
              >
                {text.diff}
              </Button>
            ) : null}
            {onClose ? (
              <IconButton
                icon="close"
                label={text.close}
                variant="ghost"
                size="sm"
                onClick={onClose}
              />
            ) : null}
          </span>
        </header>
      ) : null}
      {body}
    </section>
  );
}
