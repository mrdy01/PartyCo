import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, initialsOf, type Member } from '../../identity.ts';
import { Rich, type RichText } from '../Toast/rich.tsx';
import { ResolutionPath, type ResolutionStep } from '../ResolutionPath/ResolutionPath.tsx';
import s from './IncidentModal.module.css';

/** Which status token the right-hand flag of a participant row uses (text role). */
export type IncidentFlag = 'success' | 'warning' | 'danger' | 'running' | 'neutral';

export interface IncidentParticipant {
  member: Member;
  /** What this member did, e.g. `записал 14 строк`. */
  action: string;
  /** Short verdict shown right-aligned, e.g. `после истечения`. */
  flag?: string;
  flagStatus?: IncidentFlag;
}

export interface IncidentModalProps {
  open: boolean;
  /** `Инцидент #14 · пересечение зон`. */
  title: string;
  /** What happened, in prose. The spec forbids showing raw git conflict output here. */
  summary: RichText;
  steps: readonly ResolutionStep[];
  /** Esc, the scrim and «Позже» all route here. */
  onClose: () => void;
  onApply?: ((step: ResolutionStep, stepNumber: number) => void) | undefined;
  timestamp?: string | undefined;
  participants?: readonly IncidentParticipant[] | undefined;
  identitySet?: IdentitySetName | undefined;
  participantsLabel?: string | undefined;
  resolutionLabel?: string | undefined;
  footerNote?: string | undefined;
  laterLabel?: string | undefined;
  /** Label of the primary button; receives the 1-based number of the chosen path. */
  applyLabel?: ((stepNumber: number) => string) | undefined;
  /** Supply together with `onSelectStep` to control the choice from outside. */
  selectedStepId?: string | undefined;
  onSelectStep?: ((id: string) => void) | undefined;
  closeOnScrimClick?: boolean | undefined;
  className?: string | undefined;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
].join(',');

function focusableIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // tabIndex < 0 keeps the roving-tabindex radios out of the Tab cycle, as the pattern requires.
    (element) => element.tabIndex >= 0 && element.offsetParent !== null,
  );
}

const DEFAULT_FOOTER_NOTE =
  'Сырой git-конфликт не показывается — система решает за тебя структуру, ты решаешь смысл.';

function defaultApplyLabel(stepNumber: number): string {
  return `Применить путь ${stepNumber}`;
}

/**
 * A conflict is an incident: who did what, in which zone, and the ways out. Modal because the
 * mechanism did not hold and the user has to decide the meaning — but trunk is already safe, so the
 * copy says so instead of alarming.
 */
export function IncidentModal({
  open,
  title,
  summary,
  steps,
  onClose,
  onApply,
  timestamp,
  participants,
  identitySet,
  participantsLabel = 'Участники инцидента',
  resolutionLabel,
  footerNote = DEFAULT_FOOTER_NOTE,
  laterLabel = 'Позже',
  applyLabel = defaultApplyLabel,
  selectedStepId,
  onSelectStep,
  closeOnScrimClick = true,
  className,
}: IncidentModalProps): ReactElement | null {
  const dialog = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const summaryId = useId();
  const [ownSelection, setOwnSelection] = useState<string | undefined>(undefined);

  // Scroll lock, initial focus, and focus restored to whatever opened the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement as HTMLElement | null;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => {
      body.style.overflow = previousOverflow;
      trigger?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) setOwnSelection(undefined);
  }, [open]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const stops = focusableIn(dialog.current);
      if (stops.length === 0) {
        event.preventDefault();
        return;
      }
      const first = stops[0] as HTMLElement;
      const last = stops[stops.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const handleScrim = (event: MouseEvent<HTMLDivElement>): void => {
    if (!closeOnScrimClick) return;
    if (event.target === event.currentTarget) onClose();
  };

  if (!open) return null;

  const fallback =
    steps.find((step) => step.recommended && !step.disabled)?.id ??
    steps.find((step) => !step.disabled)?.id;
  const selected = selectedStepId ?? ownSelection ?? fallback;
  const selectedIndex = steps.findIndex((step) => step.id === selected);
  const selectedStep = selectedIndex < 0 ? undefined : steps[selectedIndex];
  const selectedNumber = selectedIndex < 0 ? 1 : selectedIndex + 1;

  const handleSelect = (id: string): void => {
    setOwnSelection(id);
    onSelectStep?.(id);
  };

  return (
    <div className={s.scrim} onMouseDown={handleScrim} onKeyDown={handleKeyDown}>
      <div
        ref={dialog}
        className={[s.dialog, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        tabIndex={-1}
      >
        <header className={s.header}>
          <Icon name="incident" className={s.headerIcon} />
          <h2 className={s.title} id={titleId}>
            {title}
          </h2>
          {timestamp ? <span className={s.time}>{timestamp}</span> : null}
        </header>

        <div className={s.body}>
          <p className={s.summary} id={summaryId}>
            <Rich value={summary} />
          </p>

          {participants && participants.length > 0 ? (
            <ul className={s.participants} aria-label={participantsLabel}>
              {participants.map((participant) => (
                <li key={participant.member.id} className={s.participant}>
                  <span
                    className={s.avatar}
                    style={avatarStyle(participant.member.colorSlug, identitySet)}
                    aria-hidden="true"
                  >
                    {initialsOf(participant.member)}
                  </span>
                  <span className={s.name}>{participant.member.name}</span>
                  <span className={s.action}>{participant.action}</span>
                  {participant.flag ? (
                    <span className={s.flag} data-status={participant.flagStatus ?? 'neutral'}>
                      {participant.flag}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <ResolutionPath
            steps={steps}
            label={resolutionLabel}
            selectedId={selected}
            onSelect={handleSelect}
          />
        </div>

        <footer className={s.footer}>
          {footerNote ? <span className={s.note}>{footerNote}</span> : null}
          <button type="button" className={s.later} onClick={onClose}>
            {laterLabel}
          </button>
          <button
            type="button"
            className={s.apply}
            disabled={!selectedStep}
            onClick={() => {
              if (selectedStep) onApply?.(selectedStep, selectedNumber);
            }}
          >
            {applyLabel(selectedNumber)}
          </button>
        </footer>
      </div>
    </div>
  );
}
