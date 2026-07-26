import type { ReactElement } from 'react';
import styles from './Skeleton.module.css';

export type SkeletonVariant = 'bar' | 'block';
export type SkeletonRadius = 'xs' | 'sm' | 'md' | 'lg';

export interface SkeletonProps {
  /**
   * `bar` — a line standing in for text (height is a third of the row height, so it scales with
   * density). `block` — a square slot standing in for an icon or an avatar.
   */
  variant?: SkeletonVariant;
  /** Take the remaining space of the flex row. Mutually exclusive with `width` in practice. */
  grow?: boolean;
  /** Explicit width — a percentage keeps the placeholder honest across panel widths. */
  width?: string | number | undefined;
  /** Explicit height. Leave unset to inherit the variant's density-aware height. */
  height?: string | number | undefined;
  /** Corner radius. Defaults: `bar` → xs, `block` → the avatar radius. */
  radius?: SkeletonRadius;
  /** Set to `false` to freeze the shimmer while keeping the reserved space. */
  animated?: boolean;
  className?: string;
}

const RADIUS_CLASS: Record<SkeletonRadius, string | undefined> = {
  xs: styles.radiusXs,
  sm: styles.radiusSm,
  md: styles.radiusMd,
  lg: styles.radiusLg,
};

/**
 * The shimmer primitive. Uses the global `pc-shimmer` keyframe from the token layer (which is
 * already neutralised under `prefers-reduced-motion`).
 *
 * It is always `aria-hidden`: a placeholder carries no information. Announce the wait once, on the
 * container — see `LoadingState`, which does exactly that.
 */
export function Skeleton({
  variant = 'bar',
  grow = false,
  width,
  height,
  radius,
  animated = true,
  className,
}: SkeletonProps): ReactElement {
  const classes = [
    styles.skeleton,
    variant === 'block' ? styles.block : styles.bar,
    grow ? styles.grow : '',
    animated ? '' : styles.frozen,
    radius ? RADIUS_CLASS[radius] ?? '' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      aria-hidden="true"
      className={classes}
      style={width !== undefined || height !== undefined ? { width, height } : undefined}
    />
  );
}
