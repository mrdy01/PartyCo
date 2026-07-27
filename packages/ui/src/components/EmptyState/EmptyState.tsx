import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import styles from './EmptyState.module.css';

/**
 * One call to action inside a state block. Deliberately data, not JSX: empty and error states are
 * rendered from configuration in dozens of panels, and a plain object keeps them uniform.
 */
export interface StateAction {
  /**
   * What the action does. **Without it the action is not drawn** — see `StateActionButton`. It stays
   * optional rather than required because these objects are assembled from copy blocks where the
   * handler is attached later (or not at all), and a compile error there would only push callers to
   * pass `() => {}`, which is the same dead button with the type system's blessing.
   */
  onClick?: () => void;
  label: string;
  /** Keyboard shortcut shown as a `<kbd>` inside the button, e.g. `L`. */
  hint?: string;
  /** `primary` — bordered; `ghost` — text only, for the secondary escape hatch. */
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  /** Overrides the accessible name when `label` alone is ambiguous. */
  ariaLabel?: string;
}

export interface StateActionButtonProps {
  action: StateAction;
  className?: string;
}

/**
 * The button used by every state block. Lives here because `EmptyState` is its primary home and
 * `ErrorState` reuses it verbatim — two copies of the same 24px control would drift.
 *
 * **An action with no `onClick` draws nothing.** State blocks are built from copy objects, and a
 * copy object with an inviting label but no handler («Предложить границы», «Переподключить») used to
 * render a full-strength button that swallowed the click and left the panel exactly as it was. A
 * label is not a feature: when the subsystem behind it does not exist yet, the honest empty state is
 * the sentence without the button.
 */
export function StateActionButton({
  action,
  className,
}: StateActionButtonProps): ReactElement | null {
  const { label, onClick, hint, variant = 'primary', disabled, ariaLabel } = action;
  if (!onClick) return null;
  return (
    <button
      type="button"
      className={[styles.action, variant === 'ghost' ? styles.ghost : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {label}
      {hint ? <kbd className={styles.hint}>{hint}</kbd> : null}
    </button>
  );
}

/**
 * How the block reads. `neutral` — the default — is an absence: a bare glyph in border colour.
 * `success` is the rare case where the panel is empty **because the work is done** (the merge queue
 * drained, every lease released): the glyph moves into a tinted tile and takes the status colour, so
 * the state reads as a result rather than as missing data.
 */
export type EmptyStateTone = 'neutral' | 'success';

export interface EmptyStateProps {
  /** One line, sentence case, describes the situation — not the absence of data. */
  title: string;
  /** Two lines at most: what the user can do about it, or why it is empty. */
  description?: ReactNode;
  /** Outline glyph above the title. Omit for a text-only block. */
  icon?: IconName;
  /** Whether the emptiness is an absence (default) or an achievement. */
  tone?: EmptyStateTone;
  /** Calls to action, primary first. */
  actions?: StateAction[];
  /** Small mono line under the actions — counts, hints, shortcuts. */
  meta?: ReactNode;
  className?: string;
}

/**
 * Empty state for a panel, list or table. Mandatory per convention §6, together with
 * `LoadingState` and `ErrorState`.
 *
 * The glyph is drawn in `--pc-border-strong`: an empty panel is a neutral fact, so it never borrows
 * status or identity colour. The one exception is `tone="success"`, for the panel that is empty
 * because the work finished — there the glyph takes the status colour and a tinted frame. That
 * frame is a glyph tile, not an area fill, so spec §5 still holds; identity colour never appears
 * here at all.
 */
export function EmptyState({
  title,
  description,
  icon,
  tone = 'neutral',
  actions,
  meta,
  className,
}: EmptyStateProps): ReactElement {
  // Filtered here as well as inside the button so the flex row itself disappears — an empty
  // `.actions` box still spends a 12px gap under the description.
  const liveActions = (actions ?? []).filter((action) => action.onClick);

  return (
    <div className={[styles.root, className ?? ''].filter(Boolean).join(' ')}>
      {icon && tone === 'success' ? (
        <span className={styles.tile}>
          <Icon name={icon} className={styles.tileGlyph} />
        </span>
      ) : null}
      {icon && tone !== 'success' ? <Icon name={icon} className={styles.glyph} /> : null}
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {liveActions.length > 0 ? (
        <div className={styles.actions}>
          {liveActions.map((action) => (
            <StateActionButton key={action.label} action={action} />
          ))}
        </div>
      ) : null}
      {meta ? <span className={styles.meta}>{meta}</span> : null}
    </div>
  );
}
