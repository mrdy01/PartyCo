import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import s from './Kbd.module.css';

export interface KbdProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** A single keycap, e.g. `⏎`. Ignored when `keys` is given. */
  children?: ReactNode;
  /** A combination, e.g. `['Ctrl', 'K']` — one chip per key, 2px apart. */
  keys?: readonly string[] | undefined;
  /** Dimmer chrome for chips sitting inside an already-busy row (search field, list rows). */
  muted?: boolean | undefined;
}

/**
 * Keyboard-shortcut hint. Spec §03 requires the hint to sit next to the action it triggers, so this
 * is a bare inline chip with no margins of its own — the host row owns the spacing.
 */
export function Kbd({ children, keys, muted = false, className, ...rest }: KbdProps): ReactElement {
  if (keys && keys.length > 0) {
    const groupClass = [s.group, muted ? s.muted : '', className ?? ''].filter(Boolean).join(' ');
    return (
      <span className={groupClass} {...rest}>
        {keys.map((key) => (
          <kbd key={key} className={s.key}>
            {key}
          </kbd>
        ))}
      </span>
    );
  }

  const keyClass = [s.key, muted ? s.muted : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <kbd className={keyClass} {...rest}>
      {children}
    </kbd>
  );
}
