import type { ButtonHTMLAttributes, ReactElement } from 'react';
import type { IconName } from '@partyco/icons';
import { Button, type ButtonSize, type ButtonVariant } from '../Button/Button.tsx';
import s from './IconButton.module.css';

export interface IconButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'children' | 'aria-label' | 'aria-labelledby'
  > {
  icon: IconName;
  /**
   * Required: the control carries no text, so this is the only name assistive tech and the tooltip
   * can use. Russian, like the rest of the UI.
   */
  label: string;
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  loading?: boolean | undefined;
}

/**
 * Square icon-only button — the toolbar workhorse. Same variants and heights as `<Button>`; the
 * label is exposed through `aria-label` and `title` so hover and screen readers agree.
 */
export function IconButton({
  icon,
  label,
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  title,
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <Button
      variant={variant}
      size={size}
      icon={icon}
      loading={loading}
      iconOnly
      aria-label={label}
      title={title ?? label}
      className={[s.root, className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
