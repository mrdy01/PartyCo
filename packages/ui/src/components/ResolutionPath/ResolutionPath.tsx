import { useId, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { Button } from '../Button/Button.tsx';
import { Rich, type RichText } from '../Toast/rich.tsx';
import s from './ResolutionPath.module.css';

/** The affirmative control a step may carry — «Начать», «Ребейз и повтор», «Починить». */
export interface ResolutionStepAction {
  label: string;
  /** Accessible name when the bare label is ambiguous out of context. */
  ariaLabel?: string;
}

export interface ResolutionStep {
  id: string;
  /** What choosing this path does, in plain Russian. Never a git command. */
  text: RichText;
  /** The path the system suggests. Gets the success accent and is picked first by default. */
  recommended?: boolean;
  /** Overrides the tag on the right (defaults to `рекомендовано` for the recommended step). */
  note?: string;
  disabled?: boolean;
  /**
   * Primary button at the end of the row.
   *
   * **Only drawn on a read-only list** — i.e. when `onSelect` is omitted. An interactive list makes
   * the whole row a `<button>`, and a button nested inside a button is invalid HTML: the inner
   * control is unreachable by keyboard and the outer one swallows the click. On an interactive list
   * the choice *is* the row, so a second control would also be redundant.
   */
  action?: ResolutionStepAction | undefined;
}

export interface ResolutionPathProps {
  steps: readonly ResolutionStep[];
  label?: string | undefined;
  /** Currently chosen path. */
  selectedId?: string | undefined;
  /** Supply to make the sequence a keyboard-driven radiogroup; omit for a read-only list. */
  onSelect?: ((id: string) => void) | undefined;
  /**
   * Runs a step's `action` button. Ignored while `onSelect` is set: an interactive list already
   * renders every row as a `<button>`, and nesting a second one there is invalid HTML with broken
   * keyboard behaviour — so the buttons are simply not drawn. See {@link ResolutionStep.action}.
   */
  onAction?: ((id: string) => void) | undefined;
  recommendedLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * The ordered set of ways out of an incident. This is the only conflict UI the user ever sees —
 * the spec forbids surfacing raw git conflict markers, so every option is phrased as an action on
 * zones and worktrees instead.
 */
export function ResolutionPath({
  steps,
  label = 'Путь разрешения',
  selectedId,
  onSelect,
  onAction,
  recommendedLabel = 'рекомендовано',
  className,
}: ResolutionPathProps): ReactElement {
  const interactive = Boolean(onSelect);
  const labelId = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());

  const selectable = steps.filter((step) => !step.disabled);
  /** Roving tabindex target: the selection if there is one, otherwise the first usable step. */
  const tabTarget =
    selectable.find((step) => step.id === selectedId)?.id ??
    selectable.find((step) => step.recommended)?.id ??
    selectable[0]?.id;

  const focus = (id: string | undefined): void => {
    if (!id) return;
    onSelect?.(id);
    buttons.current.get(id)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string): void => {
    if (!interactive || selectable.length === 0) return;
    const index = selectable.findIndex((step) => step.id === id);
    if (index < 0) return;
    const step = (delta: number): string | undefined =>
      selectable[(index + delta + selectable.length) % selectable.length]?.id;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        focus(step(1));
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        focus(step(-1));
        break;
      case 'Home':
        event.preventDefault();
        focus(selectable[0]?.id);
        break;
      case 'End':
        event.preventDefault();
        focus(selectable[selectable.length - 1]?.id);
        break;
      default:
        break;
    }
  };

  return (
    <section className={[s.root, className].filter(Boolean).join(' ')}>
      <span className={s.label} id={labelId}>
        {label}
      </span>
      <ol
        className={s.steps}
        role={interactive ? 'radiogroup' : undefined}
        aria-labelledby={interactive ? labelId : undefined}
      >
        {steps.map((step, index) => {
          const tag = step.note ?? (step.recommended ? recommendedLabel : undefined);
          const rowClass = [
            s.step,
            interactive && s.interactive,
            step.recommended && s.recommended,
            step.id === selectedId && s.selected,
            step.disabled && s.disabled,
          ]
            .filter(Boolean)
            .join(' ');
          const inner = (
            <>
              <span className={s.badge}>{index + 1}</span>
              <span className={s.text}>
                <Rich value={step.text} />
              </span>
              {tag ? <span className={s.tag}>{tag}</span> : null}
            </>
          );
          /* Nested in an interactive row this would be a <button> inside a <button>. */
          const action =
            !interactive && step.action && onAction ? (
              <Button
                variant="primary"
                size="sm"
                className={s.action}
                disabled={step.disabled}
                aria-label={step.action.ariaLabel}
                onClick={() => onAction(step.id)}
              >
                {step.action.label}
              </Button>
            ) : null;
          return (
            <li key={step.id} className={s.item} role={interactive ? 'presentation' : undefined}>
              {interactive ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={step.id === selectedId}
                  tabIndex={step.id === tabTarget ? 0 : -1}
                  disabled={step.disabled}
                  className={rowClass}
                  onClick={() => onSelect?.(step.id)}
                  onKeyDown={(event) => handleKeyDown(event, step.id)}
                  ref={(element) => {
                    buttons.current.set(step.id, element);
                  }}
                >
                  {inner}
                </button>
              ) : (
                <div className={rowClass}>
                  {inner}
                  {action}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
