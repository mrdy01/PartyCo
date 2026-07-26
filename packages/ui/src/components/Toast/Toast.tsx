import type { ReactElement } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import { Rich, type RichText } from './rich.tsx';
import s from './Toast.module.css';

export type { RichText, TextSegment } from './rich.tsx';

/** The three outcomes a toast can report. Maps 1:1 onto the status tokens. */
export type ToastVariant = 'success' | 'warning' | 'danger';

export interface ToastAction {
  label: string;
  onClick?: (() => void) | undefined;
  /**
   * `accent` paints the action in the toast's own status colour (pill role), `quiet` is the
   * "not now" affordance, `default` is the neutral raised button.
   */
  tone?: 'default' | 'accent' | 'quiet';
  disabled?: boolean;
}

export interface ToastProps {
  variant?: ToastVariant;
  /** Plain string, segment list (for `.ts` callers) or arbitrary JSX. */
  message: RichText;
  /** Right-aligned mono detail, e.g. `48 тестов`. */
  meta?: string | undefined;
  actions?: readonly ToastAction[] | undefined;
  /** When supplied, a close button appears. Toasts never auto-dismiss themselves — the owner does. */
  onDismiss?: (() => void) | undefined;
  dismissLabel?: string | undefined;
  /** `auto` moves the actions under the message as soon as there is more than one. */
  layout?: 'auto' | 'inline' | 'stacked' | undefined;
  className?: string | undefined;
}

const VARIANT_ICON: Record<ToastVariant, IconName> = {
  success: 'check',
  warning: 'clock',
  danger: 'incident',
};

export function Toast({
  variant = 'success',
  message,
  meta,
  actions,
  onDismiss,
  dismissLabel = 'Закрыть',
  layout = 'auto',
  className,
}: ToastProps): ReactElement {
  const actionCount = actions?.length ?? 0;
  const stacked = layout === 'stacked' || (layout === 'auto' && actionCount > 1);

  const buttons = actions?.map((action) => (
    <button
      key={action.label}
      type="button"
      className={[s.action, action.tone === 'accent' && s.accent, action.tone === 'quiet' && s.quiet]
        .filter(Boolean)
        .join(' ')}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      {action.label}
    </button>
  ));

  return (
    <div
      className={[s.toast, stacked && s.toastStacked, className].filter(Boolean).join(' ')}
      data-variant={variant}
      role={variant === 'danger' ? 'alert' : 'status'}
    >
      <Icon name={VARIANT_ICON[variant]} className={s.icon} />
      <div className={s.content}>
        <span className={s.message}>
          <Rich value={message} />
        </span>
        {stacked && buttons ? <div className={s.actions}>{buttons}</div> : null}
      </div>
      {meta ? <span className={s.meta}>{meta}</span> : null}
      {!stacked && buttons ? (
        <div className={[s.actions, s.actionsInline].join(' ')}>{buttons}</div>
      ) : null}
      {onDismiss ? (
        <button type="button" className={s.dismiss} onClick={onDismiss} aria-label={dismissLabel}>
          <Icon name="close" />
        </button>
      ) : null}
    </div>
  );
}
