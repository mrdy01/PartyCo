import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from '@partyco/icons';
import s from './Checkbox.module.css';

export interface CheckboxProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'checked' | 'defaultChecked' | 'onChange' | 'type' | 'size' | 'children'
  > {
  /** Text next to the box. Wired to the input with `htmlFor`, so clicking it toggles. */
  label?: ReactNode;
  /** Second line under the label — the consequence of ticking, not a repeat of it. */
  description?: ReactNode;
  /** Controlled state. Omit to let the checkbox keep its own (see `defaultChecked`). */
  checked?: boolean | undefined;
  /** Initial state for the uncontrolled case. Ignored once `checked` is passed. */
  defaultChecked?: boolean | undefined;
  /**
   * Third visual state — «часть набора отмечена». Exposed as `aria-checked="mixed"` and as the
   * native `indeterminate` DOM flag, which no HTML attribute can set.
   */
  indeterminate?: boolean | undefined;
  onChange?: ((checked: boolean, event: ChangeEvent<HTMLInputElement>) => void) | undefined;
}

/**
 * Checkbox — **выбор в наборе** (capability-матрица, фильтры, «применить ко всем»). Spec:
 * «Checkbox и Switch · все состояния». The fill is `--pc-status-running` because ticking is a
 * selection, not a system state; a Switch turns a subsystem on and is therefore accent-coloured.
 * The two are not interchangeable and the colour is what tells them apart.
 *
 * Geometry (14px comfortable / 12px compact, radius 3/2) comes out of the density block — the box
 * is the avatar square minus its own border — so `data-density` alone moves it, per convention §4.
 */
export function Checkbox({
  label,
  description,
  checked,
  defaultChecked = false,
  indeterminate = false,
  onChange,
  disabled = false,
  id,
  className,
  ...rest
}: CheckboxProps): ReactElement {
  const autoId = useId();
  const inputId = id ?? `pc-checkbox-${autoId}`;
  const descriptionId = `${inputId}-desc`;

  const inputRef = useRef<HTMLInputElement>(null);
  const isControlled = checked !== undefined;
  const [selfChecked, setSelfChecked] = useState(defaultChecked);
  const isChecked = isControlled ? checked : selfChecked;

  // `indeterminate` lives only on the DOM node — there is no attribute for it.
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.currentTarget.checked;
      if (!isControlled) setSelfChecked(next);
      onChange?.(next, event);
    },
    [isControlled, onChange],
  );

  const hasDescription = description !== undefined && description !== null && description !== '';
  const hasLabel = label !== undefined && label !== null && label !== '';

  return (
    <span
      className={[s.root, className ?? ''].filter(Boolean).join(' ')}
      data-disabled={disabled ? 'true' : undefined}
      data-checked={isChecked || indeterminate ? 'true' : undefined}
      data-stacked={hasDescription ? 'true' : undefined}
    >
      <span className={s.control}>
        <input
          ref={inputRef}
          id={inputId}
          type="checkbox"
          className={s.input}
          checked={isChecked}
          disabled={disabled}
          onChange={handleChange}
          {...(indeterminate ? { 'aria-checked': 'mixed' as const } : {})}
          {...(hasDescription ? { 'aria-describedby': descriptionId } : {})}
          {...rest}
        />
        <span className={s.box} aria-hidden="true">
          {indeterminate ? (
            <span className={s.dash} />
          ) : isChecked ? (
            <Icon name="check" className={s.tick} strokeWidth={2.2} />
          ) : null}
        </span>
      </span>

      {hasLabel || hasDescription ? (
        <span className={s.text}>
          {hasLabel ? (
            <label className={s.title} htmlFor={inputId}>
              {label}
            </label>
          ) : null}
          {hasDescription ? (
            <span className={s.description} id={descriptionId}>
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
