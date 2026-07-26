import type { ChangeEvent, InputHTMLAttributes, KeyboardEvent, ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import { Kbd } from '../Kbd/Kbd.tsx';
import s from './SearchField.module.css';

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onSubmit'> {
  /** Keycaps for the shortcut that focuses this field, e.g. `['Ctrl', 'P']`. */
  shortcut?: readonly string[] | undefined;
  /** Convenience over `onChange` — receives the value, not the event. */
  onValueChange?: ((value: string) => void) | undefined;
  /** Enter. Receives the current value. */
  onSubmit?: ((value: string) => void) | undefined;
  /** Accessible name; the field shows no visible label in the design. */
  label?: string | undefined;
  /**
   * Chrome scale — a shorter slot that ignores the density tokens. Needed inside fixed-height OS
   * chrome (the title bar is 32px whatever the density is), where the normal `--pc-row-height`
   * field would not fit. Everywhere else leave this off.
   */
  dense?: boolean | undefined;
}

/**
 * Search input. `Esc` clears (via `onValueChange`), `Enter` submits — both are what people already
 * press, and neither adds visible chrome the design does not show.
 */
export function SearchField({
  shortcut,
  onValueChange,
  onSubmit,
  onChange,
  onKeyDown,
  label = 'Поиск',
  placeholder = 'Поиск по файлам, leases, задачам…',
  className,
  disabled = false,
  dense = false,
  ...rest
}: SearchFieldProps): ReactElement {
  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange?.(event);
    onValueChange?.(event.target.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      onValueChange?.('');
      return;
    }
    if (event.key === 'Enter') {
      onSubmit?.(event.currentTarget.value);
    }
  }

  return (
    <div
      className={[s.frame, className ?? ''].filter(Boolean).join(' ')}
      data-disabled={disabled ? 'true' : undefined}
      data-dense={dense ? 'true' : undefined}
    >
      <Icon name="search" className={s.glyph} />
      <input
        type="search"
        className={s.control}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        {...rest}
      />
      {shortcut && shortcut.length > 0 ? (
        <Kbd keys={shortcut} muted className={s.shortcut} />
      ) : null}
    </div>
  );
}
