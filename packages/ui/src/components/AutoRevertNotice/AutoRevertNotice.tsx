import type { ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import { Button } from '../Button/Button.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { HistoryStrip, type HistoryNode } from '../HistoryStrip/HistoryStrip.tsx';
import { ResolutionPath, type ResolutionStep } from '../ResolutionPath/ResolutionPath.tsx';
import { Skeleton } from '../Skeleton/Skeleton.tsx';
import { Rich, type RichText } from '../Toast/rich.tsx';
import s from './AutoRevertNotice.module.css';

/** Which of the panel's three shapes is on screen. */
export type AutoRevertNoticeState = 'ready' | 'loading' | 'error';

export interface AutoRevertNoticeLabels {
  /** Accessible name of the block. The visible heading lives in the card header above. */
  panel: string;
  /** Eyebrow over the numbered steps — `ResolutionPath` draws it itself. */
  whatNext: string;
  /** Accessible name of the timeline. */
  timeline: string;
  /**
   * Spelled-out reading of the timeline. Deliberately describes the *grammar* rather than the
   * events: the node labels already carry the events, but the dashed connector — the assertion that
   * the merge was undone — is invisible to a screen reader.
   */
  timelineDescription: string;
  openLog: string;
  resumeQueue: string;
  /** Announced while the breakdown is being read. */
  loading: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
}

export const AUTO_REVERT_NOTICE_LABELS: AutoRevertNoticeLabels = {
  panel: 'Разбор авто-отката',
  whatNext: 'Что дальше',
  timeline: 'Что происходило с патчем',
  timelineDescription:
    'События идут слева направо. Пунктирная связка перед последним узлом означает, что влитие отменено.',
  openLog: 'Открыть лог',
  resumeQueue: 'Возобновить очередь',
  loading: 'Читаю разбор отката',
  errorTitle: 'Не удалось прочитать разбор отката',
  errorDescription:
    'Сам откат уже выполнен: trunk вернулся на предыдущий зелёный коммит, claim вернулся в работу. Не читается только объяснение.',
  retry: 'Повторить',
};

/**
 * The tone of the whole panel in one sentence, and the reason the panel exists at all.
 *
 * Carries no personal name on purpose: who wrote the patch is data, not copy. The caller passes the
 * named version through `reassurance` when it has a member to name.
 */
export const AUTO_REVERT_REASSURANCE: RichText = [
  { text: 'Это не наказание и не ошибка автора.', emphasis: 'strong' },
  ' Full lane существует ровно для того, что fast lane физически не успевает проверить, а откат — штатный путь, а не авария. Метрика команды при этом не портится.',
];

/** The timeline placeholder — the strip is one caption line plus one label line tall. */
const STRIP_SKELETON_HEIGHT = 'calc(var(--pc-row-height) + var(--pc-space-16))';
/** The reassurance plate runs to two lines at the design's measure. */
const PLATE_SKELETON_HEIGHT = 'calc(var(--pc-row-height) + var(--pc-space-20))';
/** Matches `<Button size="sm">` exactly, so the buttons land without a jump. */
const ACTION_SKELETON_HEIGHT = 'calc(var(--pc-space-20) + var(--pc-space-2))';
const ACTION_SKELETON_WIDTHS = [
  'calc(var(--pc-space-32) * 2 + var(--pc-space-16))',
  'calc(var(--pc-space-32) * 4 + var(--pc-space-16))',
] as const;
/** Three lines of story, the last one short. */
const STORY_SKELETON_WIDTHS = ['100%', '100%', '58%'] as const;
/** How many step rows to reserve when the steps have not arrived yet. The design shows three. */
const STEP_SKELETON_ROWS = 3;

export interface AutoRevertNoticeProps {
  /**
   * The paragraph that tells what happened, start to finish. Rich because the design monospaces the
   * branch name inside the sentence.
   */
  story: RichText;
  /** «fast lane → влит → full lane упал → авто-revert». The dashed connector is the point. */
  timeline: readonly HistoryNode[];
  /** What happens next. Rendered read-only — nothing here is a choice the human makes. */
  steps: readonly ResolutionStep[];
  /** The «не наказание» plate. Defaults to `AUTO_REVERT_REASSURANCE`. */
  reassurance?: RichText | undefined;
  state?: AutoRevertNoticeState | undefined;
  onOpenLog?: (() => void) | undefined;
  onResumeQueue?: (() => void) | undefined;
  /** Retry for the `error` state. Omit and no retry button is drawn. */
  onRetry?: (() => void) | undefined;
  labels?: Partial<AutoRevertNoticeLabels> | undefined;
  className?: string | undefined;
}

/**
 * Body of the auto-revert card: something passed the gate, broke trunk anyway, and the system undid
 * the merge on its own.
 *
 * The card's red header is a separate component — this one paints only what sits under it, which is
 * why nothing here carries danger colour or a frame. The panel is an explanation, not a second
 * alarm: the story is neutral text, the only tint on the surface is the success plate, and no
 * sentence assigns blame. Full lane exists precisely for what fast lane cannot afford to check.
 *
 * **There is no empty state, by design.** The panel is driven by an event: if no revert happened,
 * the caller renders nothing at all. An «откатов не было» placeholder would invent a fact the queue
 * never asserted. `loading` and `error` do exist, because the breakdown is fetched separately from
 * the header — and the error copy has to say the revert itself already succeeded, so that a failed
 * read is not mistaken for a stuck trunk.
 */
export function AutoRevertNotice({
  story,
  timeline,
  steps,
  reassurance,
  state = 'ready',
  onOpenLog,
  onResumeQueue,
  onRetry,
  labels,
  className,
}: AutoRevertNoticeProps): ReactElement {
  const text: AutoRevertNoticeLabels = labels
    ? { ...AUTO_REVERT_NOTICE_LABELS, ...labels }
    : AUTO_REVERT_NOTICE_LABELS;
  const root = [s.root ?? '', className ?? ''].filter(Boolean).join(' ');

  if (state === 'error') {
    return (
      <div className={root} data-state="error">
        <ErrorState
          title={text.errorTitle}
          description={text.errorDescription}
          retryLabel={text.retry}
          {...(onRetry ? { onRetry } : {})}
        />
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div
        className={root}
        data-state="loading"
        role="status"
        aria-busy="true"
        aria-label={text.loading}
      >
        <div className={s.main}>
          <div className={s.storySkeleton}>
            {STORY_SKELETON_WIDTHS.map((width) => (
              <Skeleton key={width} width={width} />
            ))}
          </div>
          <Skeleton
            className={s.blockSkeleton ?? ''}
            height={STRIP_SKELETON_HEIGHT}
            radius="sm"
          />
          <Skeleton
            className={s.blockSkeleton ?? ''}
            height={PLATE_SKELETON_HEIGHT}
            radius="sm"
          />
        </div>
        <div className={s.aside}>
          <Skeleton width="42%" />
          <div className={s.stepsSkeleton}>
            {Array.from(
              { length: steps.length > 0 ? steps.length : STEP_SKELETON_ROWS },
              (_, index) => (
                <div key={index} className={s.stepSkeleton}>
                  <Skeleton variant="block" width="var(--pc-space-16)" radius="sm" />
                  <Skeleton grow />
                </div>
              ),
            )}
          </div>
          <div className={s.actions}>
            {ACTION_SKELETON_WIDTHS.map((width) => (
              <Skeleton key={width} width={width} height={ACTION_SKELETON_HEIGHT} radius="sm" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className={root} aria-label={text.panel}>
      <div className={s.main}>
        <p className={s.story}>
          <Rich value={story} />
        </p>

        {timeline.length > 0 ? (
          <HistoryStrip
            nodes={timeline}
            label={text.timeline}
            {...(text.timelineDescription ? { description: text.timelineDescription } : {})}
            className={s.strip ?? ''}
          />
        ) : null}

        {/* Status colour as a plate tint plus its outline and its glyph — the Badge recipe at
            plate scale. The text stays --pc-text-1, so success never becomes a fill that means
            something. */}
        <p className={s.reassurance}>
          <Icon name="keychain" className={s.reassuranceGlyph ?? ''} />
          <span className={s.reassuranceText}>
            <Rich value={reassurance ?? AUTO_REVERT_REASSURANCE} />
          </span>
        </p>
      </div>

      <div className={s.aside}>
        {/* Read-only: no `onSelect`, no per-step action. Nothing here is a decision — the queue
            already made it. */}
        <ResolutionPath steps={steps} label={text.whatNext} className={s.steps ?? ''} />

        {onOpenLog || onResumeQueue ? (
          <div className={s.actions}>
            {onOpenLog ? (
              <Button size="sm" variant="secondary" onClick={onOpenLog}>
                {text.openLog}
              </Button>
            ) : null}
            {onResumeQueue ? (
              <Button size="sm" variant="ghost" onClick={onResumeQueue}>
                {text.resumeQueue}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
