import {
  useCallback,
  useId,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import s from './Switch.module.css';

export interface SwitchProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'checked' | 'defaultChecked' | 'onChange' | 'type' | 'size' | 'children' | 'role'
  > {
  /** Text next to the track. Wired with `htmlFor`, so clicking it flips the switch. */
  label?: ReactNode;
  /** Second line — what turning this on actually does. */
  description?: ReactNode;
  /** Controlled state. Omit to let the switch keep its own (see `defaultChecked`). */
  checked?: boolean | undefined;
  /** Initial state for the uncontrolled case. Ignored once `checked` is passed. */
  defaultChecked?: boolean | undefined;
  onChange?: ((checked: boolean, event: ChangeEvent<HTMLInputElement>) => void) | undefined;
}

/**
 * Switch — **включение подсистемы** (streaming, автопродление lease, consent-gate). Spec:
 * «Checkbox и Switch · все состояния». The track fills with `--pc-accent` because flipping it acts
 * immediately, without a «Сохранить»; a Checkbox selects inside a set and is therefore blue.
 *
 * There is no third position: «Индетерминированное состояние есть только у checkbox». 26×15
 * comfortable / 22×13 compact, both derived from the density block rather than written down.
 */
export function Switch({
  label,
  description,
  checked,
  defaultChecked = false,
  onChange,
  disabled = false,
  id,
  className,
  ...rest
}: SwitchProps): ReactElement {
  const autoId = useId();
  const inputId = id ?? `pc-switch-${autoId}`;
  const descriptionId = `${inputId}-desc`;

  const isControlled = checked !== undefined;
  const [selfChecked, setSelfChecked] = useState(defaultChecked);
  const isChecked = isControlled ? checked : selfChecked;

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
      data-checked={isChecked ? 'true' : undefined}
      data-stacked={hasDescription ? 'true' : undefined}
    >
      <span className={s.control}>
        <input
          id={inputId}
          type="checkbox"
          role="switch"
          className={s.input}
          checked={isChecked}
          aria-checked={isChecked}
          disabled={disabled}
          onChange={handleChange}
          {...(hasDescription ? { 'aria-describedby': descriptionId } : {})}
          {...rest}
        />
        <span className={s.track} aria-hidden="true">
          <span className={s.knob} />
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
