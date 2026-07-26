import { useMemo, type ReactElement } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { Icon } from '@partyco/icons';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import { Skeleton } from '../Skeleton/Skeleton.tsx';
import {
  MERGE_CHECK_STATE_LABEL,
  checkProgress,
  type MergeCheck,
  type MergeCheckState,
  type MergeQueueRow,
} from '../MergeQueueTable/model.ts';
import s from './PatchDetail.module.css';

/* ------------------------------------------------------------------ data */

/**
 * One file inside the patch. `path` doubles as the list key — a diff cannot contain the same path
 * twice, so an extra id would only be another thing to keep in sync.
 *
 * Both counters are optional because a file can be pure addition or pure deletion, and the row must
 * then print one number rather than a zero that reads as "nothing happened here".
 */
export interface PatchFile {
  path: string;
  added?: number | undefined;
  removed?: number | undefined;
}

/** Tone of a timeline dot. Status colour as a dot — role #1 of the four allowed. */
export type PatchHistoryTone = 'ok' | 'running' | 'neutral' | 'danger';

export interface PatchHistoryEntry {
  id: string;
  /** The event: «Fast lane пройден». */
  title: string;
  /** The mechanical detail under it: «8.5 с · 6 проверок». Relative ages only, never a clock. */
  note?: string | undefined;
  tone?: PatchHistoryTone | undefined;
}

/* ---------------------------------------------------------------- labels */

export interface PatchDetailLabels {
  /** Accessible name of the whole column, used while it has no patch to name itself after. */
  panelTitle: string;
  diffTitle: string;
  checksTitle: string;
  historyTitle: string;
  /** «6 файлов» — the right-hand meta of the diff section. */
  filesCount: (count: number) => string;
  /** «+ ещё 4 файла» — the remainder, not a file. */
  moreFiles: (count: number) => string;
  /** Prefix before `row.patchId`. Latin: it is an id, not a word. */
  patchPrefix: string;
  /** Prefix used instead, when the row carries no patch id yet. */
  claimPrefix: string;
  openDiff: string;
  retry: string;
  remove: string;
  /** Why «Убрать из очереди» is safe. The sentence exists to remove the fear of the button. */
  removeNote: string;
  emptyTitle: string;
  emptyDescription: string;
  loading: string;
  errorDescription: string;
  errorRetry: string;
  /** Accessible name of the added/removed proportion bar. */
  diffBarLabel: (added: number, removed: number) => string;
}

/** Russian plural for «файл» — 1 файл / 2 файла / 5 файлов. */
function filesWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'файл';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'файла';
  return 'файлов';
}

export const PATCH_DETAIL_LABELS: PatchDetailLabels = {
  panelTitle: 'Патч',
  diffTitle: 'Сводка диффа',
  checksTitle: 'Проверки',
  historyTitle: 'История прохождения',
  filesCount: (count) => `${count} ${filesWord(count)}`,
  moreFiles: (count) => `+ ещё ${count} ${filesWord(count)}`,
  patchPrefix: 'patch',
  claimPrefix: 'claim',
  openDiff: 'Открыть дифф',
  retry: 'Повторить',
  remove: 'Убрать из очереди',
  removeNote:
    'Убрать из очереди не отменяет работу: claim вернётся в WORKING, lease останется у автора.',
  emptyTitle: 'Выберите патч',
  emptyDescription: 'Здесь появятся дифф, проверки и история прохождения выбранного патча.',
  loading: 'Загружаю патч…',
  errorDescription: 'Патч продолжает идти по очереди — он не пропал вместе с панелью.',
  errorRetry: 'Загрузить снова',
  diffBarLabel: (added, removed) => `Добавлено ${added} строк, удалено ${removed}`,
};

/* ----------------------------------------------------------------- props */

export interface PatchDetailProps {
  /**
   * The selected patch. Optional on purpose: «строка не выбрана» is the panel's resting state on
   * this screen, and a caller holding `selectedRow: MergeQueueRow | null` should be able to hand it
   * over verbatim instead of inventing a second `empty` flag that can disagree with it.
   */
  row?: MergeQueueRow | null | undefined;
  files?: readonly PatchFile[] | undefined;
  /** Total file count of the diff — «6 файлов». May exceed `files.length`. */
  filesTotal?: number | undefined;
  /** How many files the list does not show. The remainder, never mixed into `files`. */
  moreFiles?: number | undefined;
  history?: readonly PatchHistoryEntry[] | undefined;
  loading?: boolean | undefined;
  /** Non-empty string switches the panel into its error state. */
  error?: string | null | undefined;
  onOpenDiff?: (() => void) | undefined;
  /** Re-run the checks. Rendered only when the caller can actually do it. */
  onRetry?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  /** Reload the panel after a load failure. */
  onReload?: (() => void) | undefined;
  identitySet?: IdentitySetName | undefined;
  labels?: Partial<PatchDetailLabels> | undefined;
  className?: string | undefined;
}

/* ------------------------------------------------------------- internals */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The state glyph of a check row. `passed` and `failed` are real icons; `running` is the shared
 * spinner recipe and `pending` a hollow ring — an empty circle says "nothing has happened yet"
 * without borrowing a status colour for a state that has no status.
 */
function CheckGlyph({ state }: { state: MergeCheckState }): ReactElement {
  if (state === 'running') return <span className={s.spinner} aria-hidden="true" />;
  if (state === 'passed') return <Icon name="check" className={s.glyph} />;
  if (state === 'failed') return <Icon name="close" className={s.glyph} />;
  return <span className={s.ring} aria-hidden="true" />;
}

function CheckRow({ check }: { check: MergeCheck }): ReactElement {
  const progress = check.state === 'running' ? checkProgress(check) : null;
  const stateText = MERGE_CHECK_STATE_LABEL[check.state];
  /**
   * A failed check states *why* where a passed one states how long: the duration of a failure is
   * the least interesting fact about it.
   */
  const trailing =
    check.state === 'failed' && check.failure ? check.failure : check.duration ?? null;

  return (
    <li className={s.check} data-state={check.state}>
      <CheckGlyph state={check.state} />
      <span className={s.checkName}>{check.label}</span>
      {progress ? (
        <span className={s.progress}>
          <span className={s.progressTrack} aria-hidden="true">
            <span className={s.progressFill} style={{ width: `${progress.pct}%` }} />
          </span>
          <span className={s.progressLabel}>{progress.label}</span>
        </span>
      ) : (
        <span className={s.trailing}>{trailing ?? stateText}</span>
      )}
      {progress || trailing ? <span className={s.srOnly}>{stateText}</span> : null}
    </li>
  );
}

/* ------------------------------------------------------------- component */

/**
 * The patch panel: what the diff contains, which checks have run on it, how it got here, and the
 * three things a human may do about it.
 *
 * The footnote under the actions is load-bearing rather than decorative. «Убрать из очереди» reads
 * like cancelling somebody's work, and the sentence is where the product states that it is not:
 * the claim goes back to WORKING and the lease stays with its author. Without it the button is one
 * people do not press.
 */
export function PatchDetail({
  row,
  files,
  filesTotal,
  moreFiles,
  history,
  loading = false,
  error = null,
  onOpenDiff,
  onRetry,
  onRemove,
  onReload,
  identitySet,
  labels,
  className,
}: PatchDetailProps): ReactElement {
  const text: PatchDetailLabels = useMemo(() => ({ ...PATCH_DETAIL_LABELS, ...labels }), [labels]);

  const fileList = files ?? [];
  const historyList = history ?? [];
  const patchLabel = row
    ? row.patchId
      ? `${text.patchPrefix} ${row.patchId}`
      : `${text.claimPrefix} ${row.claimId}`
    : null;

  const added = row?.diff.added ?? 0;
  const removed = row?.diff.removed ?? 0;
  const total = added + removed;
  /* An empty diff leaves the track empty rather than painting it entirely one colour. */
  const addedPct = total > 0 ? (added / total) * 100 : 0;
  const removedPct = total > 0 ? 100 - addedPct : 0;

  const hasActions = Boolean(onOpenDiff || onRetry || onRemove);

  const head =
    row && patchLabel ? (
      <header className={s.head}>
        <Avatar member={row.author} size="xs" identitySet={identitySet} />
        <span className={s.branch}>{row.branch}</span>
        <span className={s.patchId}>{patchLabel}</span>
      </header>
    ) : null;

  /* ------------------------------------------------------------- states */

  if (error) {
    return (
      <section className={cx(s.panel, className)} aria-label={patchLabel ?? text.panelTitle}>
        {head}
        <div className={s.stateBody}>
          <ErrorState
            title={error}
            description={text.errorDescription}
            retryLabel={text.errorRetry}
            {...(onReload ? { onRetry: onReload } : {})}
          />
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className={cx(s.panel, className)} aria-label={patchLabel ?? text.panelTitle}>
        {head}
        <div className={s.body}>
          <section className={s.block}>
            <h4 className={s.blockTitle}>{text.diffTitle}</h4>
            <Skeleton radius="sm" height="calc(var(--pc-space-4) + var(--pc-border-width))" />
            <LoadingState
              rows={3}
              label={text.loading}
              columns={[{ width: '1fr' }, { width: '18%' }]}
            />
          </section>
          <section className={s.block}>
            <h4 className={s.blockTitle}>{text.checksTitle}</h4>
            <LoadingState
              rows={4}
              label={text.checksTitle}
              columns={[
                { width: 'calc(var(--pc-space-8) + var(--pc-space-2))', variant: 'block' },
                { width: '1fr' },
                { width: '20%' },
              ]}
            />
          </section>
          <section className={s.block}>
            <h4 className={s.blockTitle}>{text.historyTitle}</h4>
            <LoadingState rows={3} label={text.historyTitle} />
          </section>
        </div>
        {hasActions ? (
          <div className={s.footer} aria-hidden="true">
            <div className={s.actions}>
              <Skeleton
                variant="block"
                radius="sm"
                width="calc(var(--pc-space-32) * 2 + var(--pc-space-12))"
                height="calc(var(--pc-space-20) + var(--pc-space-2))"
              />
              <Skeleton
                variant="block"
                radius="sm"
                width="calc(var(--pc-space-32) + var(--pc-space-24))"
                height="calc(var(--pc-space-20) + var(--pc-space-2))"
              />
            </div>
            {onRemove ? <Skeleton width="88%" /> : null}
          </div>
        ) : null}
      </section>
    );
  }

  if (!row) {
    return (
      <section className={cx(s.panel, className)} aria-label={text.emptyTitle}>
        <div className={s.stateBody}>
          <EmptyState title={text.emptyTitle} description={text.emptyDescription} icon="diff" />
        </div>
      </section>
    );
  }

  /* ------------------------------------------------------------ content */

  return (
    <section
      className={cx(s.panel, className)}
      aria-label={patchLabel ? `${patchLabel} · ${row.branch}` : row.branch}
    >
      {head}

      <div className={s.body}>
        <section className={s.block} aria-label={text.diffTitle}>
          <div className={s.blockHead}>
            <h4 className={s.blockTitle}>{text.diffTitle}</h4>
            {filesTotal != null ? (
              <span className={s.blockMeta}>{text.filesCount(filesTotal)}</span>
            ) : null}
          </div>

          {/*
            The bar and the two counters are one statement drawn twice, so the row is a single
            picture with one spoken form — «+214 −38» read out glyph by glyph is not it.
          */}
          <div className={s.diffRow} role="img" aria-label={text.diffBarLabel(added, removed)}>
            <span className={s.diffTrack}>
              <span className={s.diffAdded} style={{ width: `${addedPct}%` }} />
              <span className={s.diffRemoved} style={{ width: `${removedPct}%` }} />
            </span>
            <span className={s.added}>+{added}</span>
            <span className={s.removed}>−{removed}</span>
          </div>

          {fileList.length > 0 || moreFiles ? (
            <div className={s.files}>
              {fileList.length > 0 ? (
                <ul className={s.fileRows}>
                  {fileList.map((file) => (
                    <li key={file.path} className={s.file}>
                      <span className={s.filePath}>{file.path}</span>
                      <span className={s.fileCounts}>
                        {file.added != null ? (
                          <span className={s.added}>+{file.added}</span>
                        ) : null}
                        {file.removed != null ? (
                          <span className={s.removed}>−{file.removed}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {moreFiles ? <p className={s.more}>{text.moreFiles(moreFiles)}</p> : null}
            </div>
          ) : null}
        </section>

        {row.checks.length > 0 ? (
          <section className={s.block} aria-label={text.checksTitle}>
            <h4 className={s.blockTitle}>{text.checksTitle}</h4>
            <ul className={s.checks}>
              {row.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </section>
        ) : null}

        {historyList.length > 0 ? (
          <section className={s.block} aria-label={text.historyTitle}>
            <h4 className={s.blockTitle}>{text.historyTitle}</h4>
            <ol className={s.timeline}>
              {historyList.map((entry, index) => (
                <li key={entry.id} className={s.event} data-tone={entry.tone ?? 'neutral'}>
                  <span className={s.rail} aria-hidden="true">
                    <span className={s.dot} />
                    {index < historyList.length - 1 ? <span className={s.line} /> : null}
                  </span>
                  <span className={s.eventBody}>
                    <span className={s.eventTitle}>{entry.title}</span>
                    {entry.note ? <span className={s.eventNote}>{entry.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>

      {hasActions ? (
        <footer className={s.footer}>
          <div className={s.actions}>
            {onOpenDiff ? (
              <Button variant="secondary" size="sm" onClick={onOpenDiff}>
                {text.openDiff}
              </Button>
            ) : null}
            {onRetry ? (
              <Button variant="ghost" size="sm" className={s.quiet} onClick={onRetry}>
                {text.retry}
              </Button>
            ) : null}
            {onRemove ? (
              <Button variant="danger" size="sm" onClick={onRemove}>
                {text.remove}
              </Button>
            ) : null}
          </div>
          {onRemove ? <p className={s.note}>{text.removeNote}</p> : null}
        </footer>
      ) : null}
    </section>
  );
}
