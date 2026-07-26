import { useId, type ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { zoneEdgeStyle } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Badge } from '../Badge/Badge.tsx';
import { Button } from '../Button/Button.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { IconButton } from '../IconButton/IconButton.tsx';
import { Skeleton } from '../Skeleton/Skeleton.tsx';
import { Rich } from '../Toast/rich.tsx';
import { GATE_REJECTION_LABELS } from '../GateRejection/GateRejection.tsx';
import type { GateReasonCode, GateRejectionData } from '../MergeQueueTable/model.ts';
import s from './GateRejectionPanel.module.css';

/* ------------------------------------------------------------------- copy */

export interface GateRejectionPanelCopy {
  /** Header. Same words as the block on screen 2.4 — one wording for one fact. */
  title: string;
  /** Prefix in front of the claim id: `claim c-2288`. A protocol value, Latin on purpose. */
  claim: string;
  /** Accessible name of the close control. */
  close: string;
  /** The reason pill, in the words a person uses — not the protocol code. */
  reason: Record<GateReasonCode, string>;
  /** Heading over the intervening writes. */
  writes: string;
  /** Heading over the ways out. */
  steps: string;
  /** Closing note. Used when the payload does not carry its own `footnote`. */
  footnote: string;
  /** The line under the skeleton. */
  loading: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
}

/**
 * Overrides. `reason` is a record and is merged one level deeper than the rest — a flat
 * `Partial<>` spread over it replaces the whole map, which is exactly how a block of copy got
 * wiped once already.
 */
export type GateRejectionPanelCopyInput = Partial<Omit<GateRejectionPanelCopy, 'reason'>> & {
  reason?: Partial<Record<GateReasonCode, string>> | undefined;
};

/**
 * The panel's own words.
 *
 * `title` is taken from `GATE_REJECTION_LABELS` rather than restated: the rule that the UI never
 * says «отклонён» has one home, and a second copy of the phrase is a second place for it to rot.
 *
 * `reason` is *not* `GATE_REASON_TITLE`. That map is the operator's shorthand («пока патч ехал»,
 * «lease держался не непрерывно»); this panel is the same three refusals said to a person, and the
 * shell has no word `lease` in it — it has «зона».
 */
export const GATE_REJECTION_PANEL_COPY: GateRejectionPanelCopy = {
  title: GATE_REJECTION_LABELS.region,
  claim: 'claim',
  close: 'Закрыть панель',
  reason: {
    intervening_write: 'в эти файлы успели записать',
    guarded_without_continuous_lease: 'зона держалась с перерывом',
    checks_failed: 'проверки не прошли',
  },
  writes: 'Что записали, пока патч ждал',
  steps: 'Как выйти',
  footnote:
    'Это не выговор. Гейт останавливает всё, что могло бы разойтись, и всегда говорит, что делать дальше. Работа не потеряна ни в одном из трёх видов отказа.',
  loading: 'Собираем дифф — обычно это меньше секунды.',
  errorTitle: 'Не получилось показать дифф',
  errorBody: 'Хаб не ответил. Твоя работа на месте — и правки, и зона. Это только просмотр.',
  errorRetry: 'Попробовать снова',
};

function mergeCopy(input?: GateRejectionPanelCopyInput): GateRejectionPanelCopy {
  if (!input) return GATE_REJECTION_PANEL_COPY;
  return {
    ...GATE_REJECTION_PANEL_COPY,
    ...input,
    reason: { ...GATE_REJECTION_PANEL_COPY.reason, ...input.reason },
  };
}

/* ------------------------------------------------------------------ props */

export type GateRejectionPanelState = 'ready' | 'loading' | 'error';

export interface GateRejectionPanelProps {
  /**
   * The refusal, in the shape screen 2.4 already uses. Optional because a panel that is still
   * fetching has nothing yet — see `state`.
   */
  rejection?: GateRejectionData | undefined;
  /** Claim id as the daemon knows it: `c-2288`. Drawn mono next to the title. */
  claimId?: string | undefined;
  /** Defaults to `ready` when there is data and `loading` when there is not. */
  state?: GateRejectionPanelState | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Draws the close control. Omit and the panel has no way to dismiss itself. */
  onClose?: (() => void) | undefined;
  /** Runs a way out by its step id. Without it the steps are a read-only list. */
  onAction?: ((stepId: string) => void) | undefined;
  /** Retry from the error state. Without it the state states the failure and offers nothing. */
  onRetry?: (() => void) | undefined;
  copy?: GateRejectionPanelCopyInput | undefined;
  className?: string | undefined;
}

/* ------------------------------------------------------------- component */

/**
 * «Не пропущен гейтом», said to a person — the slide-out panel behind the event card.
 *
 * Not a fork of `GateRejection`: that block states the three refusals in the machine's terms and
 * stays on screen 2.4 next to the queue. This is the same payload — the very same
 * `GateRejectionData` — in the shell's voice, so the two cannot drift apart in what they know.
 * What differs is only the telling: the reason becomes a sentence, the ways out become numbered
 * steps a person can act on, and the panel closes with the line that sets the tone.
 *
 * Three things it will not do:
 *
 * · no raw `<<<<<<<`, ever — the writes are named files with counts, never a conflict hunk;
 * · no wall clock — `InterveningWrite.ago` is a relative age and nothing here has a timestamp;
 * · no left edge in a status colour. The 2px left edge on a write row is the *writer's* identity
 *   colour (role #2, via `zoneEdgeStyle`); warning shows up as a dot, an outlined pill and text.
 */
export function GateRejectionPanel({
  rejection,
  claimId,
  state,
  identitySet,
  onClose,
  onAction,
  onRetry,
  copy,
  className,
}: GateRejectionPanelProps): ReactElement {
  const t = mergeCopy(copy);
  const titleId = useId();
  /* A panel told it is ready but holding nothing is still waiting — say so rather than draw a shell. */
  const view: GateRejectionPanelState =
    state === 'error' ? 'error' : rejection ? state ?? 'ready' : 'loading';

  const writes = rejection?.writes ?? [];
  const steps = rejection?.steps ?? [];
  /*
   * One first action per surface. The data says which way out is suggested; when it says nothing,
   * the first step is the one the panel leads with — a panel of equal options is not a way out.
   */
  const recommended = steps.findIndex((step) => step.recommended);
  const primaryIndex = recommended >= 0 ? recommended : 0;

  return (
    <section
      className={className ? `${s.root} ${className}` : s.root}
      aria-labelledby={titleId}
    >
      <header className={s.head}>
        <span className={s.dot} aria-hidden="true" />
        <span className={s.title} id={titleId}>
          {t.title}
        </span>
        {claimId ? <span className={s.claim}>{`${t.claim} ${claimId}`}</span> : null}
        {onClose ? (
          <IconButton
            icon="close"
            label={t.close}
            variant="ghost"
            size="md"
            className={s.close}
            onClick={onClose}
          />
        ) : null}
      </header>

      {view === 'ready' && rejection ? (
        <div className={s.body}>
          <div className={s.reason}>
            <div className={s.reasonRow}>
              {/* Status role: a pill. Outlined rather than tinted — the tint belongs to a live state. */}
              <Badge status="warning" dot={false} className={s.reasonPill}>
                {t.reason[rejection.code]}
              </Badge>
              {rejection.subject ? <span className={s.subject}>{rejection.subject}</span> : null}
            </div>
            <p className={s.explanation}>
              <Rich value={rejection.explanation} />
            </p>
          </div>

          {writes.length > 0 ? (
            <div className={s.block}>
              <span className={s.blockLabel}>{t.writes}</span>
              <ul className={s.list} aria-label={t.writes}>
                {writes.map((write) => (
                  <li
                    key={write.id}
                    className={s.write}
                    /* Identity role #2 — whose write this was, on the left edge. */
                    style={zoneEdgeStyle(write.author.colorSlug, identitySet)}
                  >
                    <Avatar member={write.author} size="xs" identitySet={identitySet} />
                    <span className={s.path}>{write.path}</span>
                    {write.added == null ? null : (
                      <span className={s.added}>{`+${write.added}`}</span>
                    )}
                    {write.removed == null ? null : (
                      <span className={s.removed}>{`−${write.removed}`}</span>
                    )}
                    <span className={s.ago}>{write.ago}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {steps.length > 0 ? (
            <div className={s.block}>
              <span className={s.blockLabel}>{t.steps}</span>
              <ol className={s.steps}>
                {steps.map((step, index) => (
                  <li key={step.id} className={s.step}>
                    <span className={s.stepNumber} aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className={s.stepBody}>
                      <p className={s.stepText}>
                        <Rich value={step.text} />
                      </p>
                      {step.action || step.note ? (
                        <div className={s.stepFoot}>
                          {step.action ? (
                            <Button
                              variant={index === primaryIndex ? 'primary' : 'secondary'}
                              size="lg"
                              disabled={step.disabled}
                              {...(step.action.ariaLabel
                                ? { 'aria-label': step.action.ariaLabel }
                                : {})}
                              {...(onAction ? { onClick: () => onAction(step.id) } : {})}
                            >
                              {step.action.label}
                            </Button>
                          ) : null}
                          {step.note ? <span className={s.stepNote}>{step.note}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className={s.footnote}>
            <Icon name="info" className={s.footnoteGlyph} />
            <p className={s.footnoteText}>{rejection.footnote ?? t.footnote}</p>
          </div>
        </div>
      ) : null}

      {view === 'loading' ? (
        <div className={s.body}>
          <div className={s.loading} role="status" aria-busy="true" aria-label={t.loading}>
            <div className={s.loadingGroup}>
              {/* Only the leading bar sweeps: a panel of churning bricks is worse than a still one. */}
              <Skeleton width="52%" />
              <Skeleton width="34%" animated={false} />
            </div>
            <div className={s.loadingGroup}>
              <Skeleton animated={false} />
              <Skeleton width="94%" animated={false} />
              <Skeleton width="76%" animated={false} />
            </div>
            <div className={s.loadingRows}>
              <Skeleton className={s.loadingRow ?? ''} animated={false} />
              <Skeleton className={s.loadingRow ?? ''} animated={false} />
            </div>
          </div>
          <span className={s.loadingNote}>{t.loading}</span>
        </div>
      ) : null}

      {view === 'error' ? (
        <div className={s.error}>
          <ErrorState
            icon="incident"
            title={t.errorTitle}
            description={t.errorBody}
            retryLabel={t.errorRetry}
            {...(onRetry ? { onRetry } : {})}
          />
        </div>
      ) : null}
    </section>
  );
}
