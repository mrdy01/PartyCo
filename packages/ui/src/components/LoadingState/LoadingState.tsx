import type { ReactElement, ReactNode } from 'react';
import { Skeleton, type SkeletonVariant } from '../Skeleton/Skeleton.tsx';
import styles from './LoadingState.module.css';

/**
 * Trailing bar widths, cycled row by row. Percentages rather than fixed widths so the placeholder
 * keeps its proportions in a narrow sidebar and in a wide panel alike.
 */
const META_WIDTHS = ['22%', '32%', '18%'] as const;

/**
 * One column of a table-shaped placeholder. `width` is a grid track — `1fr`, `28%`, or token
 * arithmetic such as `calc(var(--pc-space-32) + var(--pc-space-12))`. Never a raw pixel literal.
 */
export interface LoadingStateColumn {
  width: string;
  /** `block` for a square slot (a mode badge, an avatar); `bar` — the default — for text. */
  variant?: SkeletonVariant | undefined;
}

/**
 * How the tail of the list dims. `last` fades only the final row; `ramp` fades the last two in
 * steps, which is what a table does when the placeholder continues past the fold.
 */
export type LoadingStateFade = 'none' | 'last' | 'ramp';

export interface LoadingStateProps {
  /**
   * How many placeholder rows to draw. Pass the number of rows the panel will actually show — for a
   * refresh, the count you rendered last time; for a first load, the count that fills the panel.
   */
  rows?: number;
  /**
   * Column template. Supply it when the panel being loaded is a table rather than a list: the row
   * becomes a grid with exactly these tracks, so the placeholder mirrors the real column geometry
   * instead of the generic glyph / text / meta shape. Overrides `withGlyph` and `withMeta`.
   */
  columns?: readonly LoadingStateColumn[] | undefined;
  /** Leading square placeholder in each row — a file icon, an avatar, a status glyph. */
  withGlyph?: boolean;
  /** Trailing short placeholder in each row — a timestamp, a count, a branch name. */
  withMeta?: boolean;
  /** Fade the last row, hinting that the list continues past the fold. */
  fadeLast?: boolean;
  /** Finer control than `fadeLast`. When set, it wins. */
  fade?: LoadingStateFade | undefined;
  /** Small mono line under the rows. Optional — most panels do not need it. */
  caption?: ReactNode;
  /** Announced to assistive tech while the wait lasts. */
  label?: string;
  className?: string;
}

/**
 * Loading placeholder for a list-shaped panel. Convention §6 makes it mandatory next to
 * `EmptyState` and `ErrorState`.
 *
 * **No layout shift by construction.** Every placeholder row is exactly `--pc-row-height` tall with
 * `--pc-row-padding-x` of side padding — the same geometry a real row gets — and rows are stacked
 * with no extra gap, so the pitch matches the list that replaces it. A caller therefore sizes the
 * block only by choosing `rows`: `rows={items.length || 8}` on refresh keeps the panel's height
 * pixel-identical across the swap. If the panel scrolls inside a fixed frame, nothing else is
 * needed; if it grows with content, set `rows` from the previous render rather than a constant.
 *
 * The shimmer repeats row geometry on purpose — grey bricks of arbitrary size are what produce the
 * jump when data arrives.
 */
export function LoadingState({
  rows = 4,
  columns,
  withGlyph = true,
  withMeta = true,
  fadeLast = true,
  fade,
  caption,
  label = 'Загрузка',
  className,
}: LoadingStateProps): ReactElement {
  const count = Math.max(1, Math.floor(rows));
  const mode: LoadingStateFade = fade ?? (fadeLast ? 'last' : 'none');
  const grid = columns && columns.length > 0 ? columns : null;

  /** `0` — opaque, `1` — the soft step, `2` — the faint one. */
  const fadeStep = (index: number): 0 | 1 | 2 => {
    if (count < 2 || mode === 'none') return 0;
    const fromEnd = count - 1 - index;
    if (fromEnd === 0) return 2;
    if (fromEnd === 1 && mode === 'ramp') return 1;
    return 0;
  };

  return (
    <div
      className={[styles.root, className ?? ''].filter(Boolean).join(' ')}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      {Array.from({ length: count }, (_, index) => {
        const step = fadeStep(index);
        const rowClass = [
          styles.row,
          grid ? styles.gridRow : '',
          step === 2 ? styles.faded : '',
          step === 1 ? styles.fadedSoft : '',
        ]
          .filter(Boolean)
          .join(' ');

        if (grid) {
          return (
            <div
              key={index}
              className={rowClass}
              style={{ gridTemplateColumns: grid.map((column) => column.width).join(' ') }}
            >
              {grid.map((column, cell) => (
                <Skeleton key={cell} variant={column.variant ?? 'bar'} />
              ))}
            </div>
          );
        }

        return (
          <div key={index} className={rowClass}>
            {withGlyph ? <Skeleton variant="block" /> : null}
            <Skeleton grow />
            {withMeta && step !== 2 ? (
              <Skeleton width={META_WIDTHS[index % META_WIDTHS.length] ?? META_WIDTHS[0]} />
            ) : null}
          </div>
        );
      })}
      {caption ? <span className={styles.caption}>{caption}</span> : null}
    </div>
  );
}
