import { useId, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import s from './Input.module.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  /** Field label, rendered above the frame and wired with `htmlFor`. */
  label?: string | undefined;
  /** Quiet help text under the field. Hidden while an error message is shown. */
  hint?: ReactNode;
  /** `true` marks the field invalid; a string also renders the message under the field. */
  error?: string | boolean | undefined;
  /** Leading icon inside the frame. */
  icon?: IconName | undefined;
  /** Shows the success tick at the trailing edge — "значение принято". */
  valid?: boolean | undefined;
  /** Monospace value. Use for URLs, keys, ids, paths. */
  mono?: boolean | undefined;
  /** Extra trailing content (keycap hints, unit labels). */
  trailing?: ReactNode;
  /** Accessible name for the tick, so the state is not colour-only. */
  validLabel?: string | undefined;
}

/**
 * Single-line text field. The frame is a flex row rather than a styled `<input>` so a leading icon
 * and trailing affordances can share the 28px box; focus is still driven by the real input, and the
 * ring uses `--pc-focus-ring` per convention §7.
 */
export function Input({
  label,
  hint,
  error = false,
  icon,
  valid = false,
  mono = false,
  trailing,
  validLabel = 'Значение принято',
  id,
  className,
  disabled = false,
  ...rest
}: InputProps): ReactElement {
  const autoId = useId();
  const inputId = id ?? `pc-input-${autoId}`;
  const messageId = `${inputId}-msg`;

  const invalid = error !== false && error !== '' && error !== undefined;
  const message = typeof error === 'string' && error !== '' ? error : null;
  const showHint = !message && hint !== undefined && hint !== null && hint !== '';

  return (
    <div
      className={[s.field, className ?? ''].filter(Boolean).join(' ')}
      data-invalid={invalid ? 'true' : undefined}
    >
      {label ? (
        <label className={s.label} htmlFor={inputId}>
          {label}
        </label>
      ) : null}

      <div className={s.frame} data-disabled={disabled ? 'true' : undefined}>
        {icon ? <Icon name={icon} className={s.glyph} /> : null}
        <input
          id={inputId}
          className={[s.control, mono ? s.mono : ''].filter(Boolean).join(' ')}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={message || showHint ? messageId : undefined}
          {...rest}
        />
        {valid ? (
          <Icon
            name="check"
            className={[s.glyph, s.valid].join(' ')}
            label={validLabel}
          />
        ) : null}
        {trailing ? <span className={s.trailing}>{trailing}</span> : null}
      </div>

      {message ? (
        <span className={s.error} id={messageId} role="alert">
          {message}
        </span>
      ) : showHint ? (
        <span className={s.hint} id={messageId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
