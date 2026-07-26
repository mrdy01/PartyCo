import type { ReactElement, ReactNode } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { OwnershipBar, type OwnershipShare } from '../OwnershipBar/OwnershipBar.tsx';
import { ModeMatrix, type ModeMatrixProps } from '../ModeMatrix/ModeMatrix.tsx';
import styles from './OwnershipSummary.module.css';

export interface OwnershipSummaryProps {
  /** Eyebrow over the bar, e.g. «Сводка · 8 границ». */
  title?: string | undefined;
  /** Owners in display order — the same shares the ownership map is drawn from. */
  shares: readonly OwnershipShare[];
  /** Boundaries nobody holds. Drawn as the neutral remainder and named in the legend. */
  free?: number | undefined;
  freeLabel?: string | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Columns of the legend grid. The design's rail uses two. */
  legendColumns?: number | undefined;
  /**
   * The mode-compatibility card under the divider. Pass `false` to leave it out, or a props bag to
   * override anything on it — highlight a mode, close it by default, hand in a looser policy.
   */
  matrix?: ModeMatrixProps | false | undefined;
  /** Anything the screen wants under the card — a note, a link, a second block. */
  children?: ReactNode | undefined;
  className?: string | undefined;
}

/**
 * The 296px rail beside the ownership map: who holds how much, and the one rule that explains why
 * the map is mostly parallel — «разные границы не конфликтуют никогда».
 *
 * It composes rather than draws: `OwnershipBar` owns the bar and the legend, `ModeMatrix` owns the
 * 4×4 grid and its disclosure. The rail's own job is the width, the rhythm and the divider.
 */
export function OwnershipSummary({
  title,
  shares,
  free,
  freeLabel,
  identitySet,
  legendColumns = 2,
  matrix,
  children,
  className,
}: OwnershipSummaryProps): ReactElement {
  const matrixProps: ModeMatrixProps | null =
    matrix === false ? null : { collapsible: true, defaultExpanded: false, ...(matrix ?? {}) };

  return (
    <aside className={[styles.root, className ?? ''].filter(Boolean).join(' ')}>
      <OwnershipBar
        shares={shares}
        {...(free !== undefined ? { free } : {})}
        {...(freeLabel !== undefined ? { freeLabel } : {})}
        {...(identitySet !== undefined ? { identitySet } : {})}
        {...(title !== undefined ? { title } : {})}
        legendColumns={legendColumns}
      />

      {matrixProps ? (
        <>
          <hr className={styles.divider} />
          <ModeMatrix {...matrixProps} />
        </>
      ) : null}

      {children}
    </aside>
  );
}
