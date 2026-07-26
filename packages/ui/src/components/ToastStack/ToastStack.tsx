import type { ReactElement } from 'react';
import { Toast, type ToastProps } from '../Toast/Toast.tsx';
import s from './ToastStack.module.css';

export interface ToastItem extends ToastProps {
  /** Stable id — the stack owner dismisses by id, so it must not be the array index. */
  id: string;
}

export type ToastPlacement =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface ToastStackProps {
  toasts: readonly ToastItem[];
  /** Called with the item id when a toast's close button is pressed. */
  onDismiss?: ((id: string) => void) | undefined;
  placement?: ToastPlacement | undefined;
  /**
   * `fixed` pins the stack to a window corner (the app case); `static` lets the parent place it,
   * which is what the design-system preview does.
   */
  position?: 'fixed' | 'static' | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

export function ToastStack({
  toasts,
  onDismiss,
  placement = 'bottom-right',
  position = 'fixed',
  label = 'Уведомления',
  className,
}: ToastStackProps): ReactElement | null {
  if (toasts.length === 0) return null;
  return (
    <div
      className={[s.stack, position === 'fixed' && s.fixed, className].filter(Boolean).join(' ')}
      data-placement={placement}
      aria-label={label}
    >
      {toasts.map(({ id, onDismiss: own, ...toast }) => {
        const dismiss = own ?? (onDismiss ? () => onDismiss(id) : undefined);
        return <Toast key={id} {...toast} onDismiss={dismiss} />;
      })}
    </div>
  );
}
