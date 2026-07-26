import { useId, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import s from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: readonly SelectOption[];
  label?: string | undefined;
  hint?: ReactNode;
  error?: string | boolean | undefined;
  /** Leading icon inside the frame. */
  icon?: IconName | undefined;
  /** Shown as a disabled first option while the value is empty. */
  placeholder?: string | undefined;
}

/**
 * Native `<select>` in PartyCo chrome. Native on purpose: keyboard, type-ahead and the OS popup all
 * come for free, and the popup follows `color-scheme`, which the token layer already sets per theme.
 */
export function Select({
  options,
  label,
  hint,
  error = false,
  icon,
  placeholder,
  id,
  className,
  disabled = false,
  value,
  defaultValue,
  ...rest
}: SelectProps): ReactElement {
  const autoId = useId();
  const selectId = id ?? `pc-select-${autoId}`;
  const messageId = `${selectId}-msg`;

  const invalid = error !== false && error !== '' && error !== undefined;
  const message = typeof error === 'string' && error !== '' ? error : null;
  const showHint = !message && hint !== undefined && hint !== null && hint !== '';
  const isEmpty = value === '' || (value === undefined && defaultValue === undefined && !!placeholder);

  return (
    <div
      className={[s.field, className ?? ''].filter(Boolean).join(' ')}
      data-invalid={invalid ? 'true' : undefined}
    >
      {label ? (
        <label className={s.label} htmlFor={selectId}>
          {label}
        </label>
      ) : null}

      <div className={s.frame} data-disabled={disabled ? 'true' : undefined}>
        {icon ? <Icon name={icon} className={s.glyph} /> : null}
        <select
          id={selectId}
          className={s.control}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={message || showHint ? messageId : undefined}
          data-placeholder={isEmpty ? 'true' : undefined}
          value={value}
          defaultValue={value === undefined && placeholder && defaultValue === undefined ? '' : defaultValue}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        {/* Chevron geometry copied from the design export — the icon set has no chevron. */}
        <svg className={s.chevron} viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M4.4 6.4L8 10l3.6-3.6" />
        </svg>
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
