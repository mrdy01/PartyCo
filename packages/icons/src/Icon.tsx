import type { CSSProperties, SVGProps } from 'react';
import { ICON_PATHS, type IconName } from './paths.ts';

export type { IconName };
export { ICON_NAMES } from './paths.ts';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> {
  name: IconName;
  /** Rendered size in px. Defaults to the 16px grid the set was drawn on. */
  size?: number;
  /**
   * Stroke width. Defaults to 1.3 per spec §04. Scale it yourself if you render far from 16px —
   * the geometry was drawn for 16 and thin strokes go muddy when upscaled.
   */
  strokeWidth?: number;
  /** Accessible label. Omit for purely decorative icons — then the icon is hidden from AT. */
  label?: string;
}

const BASE: CSSProperties = { flex: 'none', display: 'block' };

/**
 * The single icon primitive. Spec §04: 16px grid, 1.3 stroke, round caps and joins, no fills, and
 * "иконка никогда не несёт цвет сама — цвет приходит от состояния строки". Hence `currentColor`:
 * set `color` on the row and every icon inside follows. Never pass a hard-coded stroke colour.
 */
export function Icon({
  name,
  size = 16,
  strokeWidth = 1.3,
  label,
  style,
  ...rest
}: IconProps): React.ReactElement {
  const body = ICON_PATHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style ? { ...BASE, ...style } : BASE}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...rest}
      // Geometry comes from a generated constant in this package — not from user or remote input.
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
