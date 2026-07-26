import type { ButtonHTMLAttributes, MouseEvent, ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import { Kbd } from '../Kbd/Kbd.tsx';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  /**
   * `primary` is the one affirmative action of a surface; `danger` is destructive; `warning` is
   * the amber "interrupt what is running" control (stopping an autonomous agent) — it removes
   * authority rather than data, so it must not read as destructive.
   */
  variant?: ButtonVariant | undefined;
  /** 22 / 26 / 30 px tall, per design §05. */
  size?: ButtonSize | undefined;
  /** Leading icon. Replaced by the spinner while `loading`. */
  icon?: IconName | undefined;
  /** Trailing icon, to the right of the label. */
  iconEnd?: IconName | undefined;
  /**
   * In-flight action: shows the spinner, sets `aria-busy` and swallows clicks. The button stays
   * focusable on purpose — a busy control that disappears from the tab order loses the user.
   */
  loading?: boolean | undefined;
  /** Label shown instead of `children` while loading, e.g. `Синхронизация`. */
  loadingLabel?: ReactNode;
  /** Keyboard hint rendered as keycaps after the label, e.g. `['⏎']`. */
  shortcut?: readonly string[] | undefined;
  fullWidth?: boolean | undefined;
  /** Square, icon-only geometry. `<IconButton>` sets this — prefer that component. */
  iconOnly?: boolean | undefined;
}

/**
 * The button primitive. Radius, heights, paddings and colours all come from tokens, so the same
 * markup is correct in both themes and both densities.
 */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  iconEnd,
  loading = false,
  loadingLabel,
  shortcut,
  fullWidth = false,
  iconOnly = false,
  className,
  disabled = false,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps): ReactElement {
  const classes = [
    s.root,
    s[variant],
    s[size],
    iconOnly ? s.iconOnly : '',
    fullWidth ? s.fullWidth : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const label = loading && loadingLabel !== undefined ? loadingLabel : children;

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-loading={loading ? 'true' : undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <span className={s.spinner} /> : null}
      {!loading && icon ? <Icon name={icon} className={s.glyph} /> : null}
      {label !== undefined && label !== null && label !== '' ? (
        <span className={s.label}>{label}</span>
      ) : null}
      {iconEnd ? <Icon name={iconEnd} className={s.glyph} /> : null}
      {shortcut && shortcut.length > 0 ? (
        <Kbd keys={shortcut} muted className={s.shortcut} />
      ) : null}
    </button>
  );
}
