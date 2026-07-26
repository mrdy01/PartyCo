import type { ReactNode } from 'react';
import styles from './ProviderGlyph.module.css';

export type ProviderGlyphVariant = 'stub' | 'add';

export interface ProviderGlyphProps {
  /**
   * Stable provider key — `anthropic`, `openai`, `google`, `deepseek`, `kimi`, or any self-hosted
   * id. This is the whole contract: nothing about the visual depends on the id beyond the fallback
   * letter, so a real mark can replace the stub without touching callers.
   */
  providerId: string;
  /**
   * The real provider mark. Pass an `<svg>` (or an `<img>`) at integration time and it fills the
   * slot; the slot geometry, radius and chip layout stay exactly as they are. Until then the
   * letter stub is drawn.
   */
  mark?: ReactNode | undefined;
  /** Visible provider name. When set, the glyph is wrapped in the labelled chip from the design. */
  label?: string | undefined;
  /** Override the stub letter. Defaults to the first character of `label` ?? `providerId`. */
  letter?: string | undefined;
  /** `add` is the dashed «Свой» affordance for registering your own provider. */
  variant?: ProviderGlyphVariant | undefined;
  /** Marks the chip as the active choice in a provider picker. */
  selected?: boolean | undefined;
  /** Makes the glyph/chip a button. */
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  /** Tooltip. Defaults to the accessible name. */
  title?: string | undefined;
  className?: string | undefined;
}

function stubLetter(
  letter: string | undefined,
  variant: ProviderGlyphVariant,
  label: string | undefined,
  providerId: string,
): string {
  if (letter) return letter;
  if (variant === 'add') return '+';
  const source = (label ?? providerId).trim();
  return source ? source.charAt(0).toUpperCase() : '?';
}

/**
 * Provider mark. The design ships letter stubs deliberately — «реальные знаки провайдеров
 * подставляются на этапе интеграции» — so the component owns the slot, not the artwork: hand it a
 * `mark` and the artwork swaps in place with identical geometry.
 */
export function ProviderGlyph({
  providerId,
  mark,
  label,
  letter,
  variant = 'stub',
  selected,
  onClick,
  disabled = false,
  title,
  className,
}: ProviderGlyphProps): React.ReactElement {
  const hasText = Boolean(label);
  const accessibleName = label ?? providerId;
  const rootClassName = className ? `${styles.root} ${className}` : styles.root;

  const glyph = (
    <span className={styles.glyph} aria-hidden="true">
      {mark ?? stubLetter(letter, variant, label, providerId)}
    </span>
  );

  const body = (
    <>
      {glyph}
      {hasText ? <span className={styles.name}>{label}</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={rootClassName}
        data-variant={variant}
        data-labelled={hasText ? 'true' : undefined}
        data-selected={selected ? 'true' : undefined}
        onClick={onClick}
        disabled={disabled}
        title={title ?? accessibleName}
        aria-pressed={selected === undefined ? undefined : selected}
        aria-label={hasText ? undefined : accessibleName}
      >
        {body}
      </button>
    );
  }

  return (
    <span
      className={rootClassName}
      data-variant={variant}
      data-labelled={hasText ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      title={title ?? accessibleName}
      {...(hasText ? {} : { role: 'img', 'aria-label': accessibleName })}
    >
      {body}
    </span>
  );
}
