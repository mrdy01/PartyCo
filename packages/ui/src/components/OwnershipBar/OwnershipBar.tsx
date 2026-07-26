import type { ReactElement } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { avatarStyle, type Member } from '../../identity.ts';
import styles from './OwnershipBar.module.css';

export interface OwnershipShare {
  /** Holder of the share. Supplies the segment colour and the legend name. */
  member: Member;
  /** How many units this member holds — boundaries, files, tasks. Zero segments are dropped. */
  count: number;
  /** Legend caption override. Defaults to the member's first name, as the design writes it. */
  label?: string | undefined;
}

export interface OwnershipBarProps {
  /** Owners, in display order. The bar keeps the order it is given — it never re-sorts. */
  shares: readonly OwnershipShare[];
  /** Units nobody holds. Drawn as the neutral remainder and named in the legend. */
  free?: number | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Eyebrow above the bar, e.g. «Владение · 6 границ». Omit for the bar alone. */
  title?: string | undefined;
  /** Wrapped legend under the bar. */
  showLegend?: boolean | undefined;
  /**
   * Lay the legend out as a fixed grid of this many columns instead of letting it wrap. The
   * ownership map's summary rail needs the two-column block the design draws there — captions of
   * different widths must still line up, which wrapping cannot promise. 2–4; anything else wraps.
   */
  legendColumns?: number | undefined;
  freeLabel?: string | undefined;
  /** Accessible name. Defaults to `title`, then to the legend read out as one line. */
  label?: string | undefined;
  className?: string | undefined;
}

function firstName(member: Member): string {
  const head = member.name.trim().split(/\s+/)[0];
  return head && head.length > 0 ? head : member.name;
}

/**
 * Stacked proportion bar: one segment per owner plus the free remainder, with a wrapped legend.
 * The panel footer under the boundary tree is its first home, but the same block answers
 * «кто чем владеет» for a milestone, a directory or a task board, so it lives on its own.
 *
 * The segment colour is identity role #1 taken through `avatarStyle` — a filled swatch of the
 * member's colour, exactly like their avatar. Nothing else here is coloured by identity.
 */
export function OwnershipBar({
  shares,
  free = 0,
  identitySet,
  title,
  showLegend = true,
  legendColumns,
  freeLabel = 'свободно',
  label,
  className,
}: OwnershipBarProps): ReactElement {
  const columns =
    legendColumns !== undefined && legendColumns >= 2 && legendColumns <= 4
      ? String(Math.floor(legendColumns))
      : undefined;

  const owned = shares.reduce((sum, share) => sum + Math.max(0, share.count), 0);
  const freeCount = Math.max(0, free);
  const total = owned + freeCount;

  const entries = shares
    .filter((share) => share.count > 0)
    .map((share) => ({
      key: share.member.id,
      caption: `${share.label ?? firstName(share.member)} ${share.count}`,
      // Percent of the whole, so segments and legend can never disagree.
      width: total > 0 ? `${(share.count / total) * 100}%` : '0%',
      style: avatarStyle(share.member.colorSlug, identitySet),
    }));

  const freeEntry =
    freeCount > 0
      ? {
          caption: `${freeLabel} ${freeCount}`,
          width: total > 0 ? `${(freeCount / total) * 100}%` : '0%',
        }
      : null;

  const summary = [...entries.map((e) => e.caption), ...(freeEntry ? [freeEntry.caption] : [])].join(
    ', ',
  );
  const barName = label ?? title ?? summary;

  return (
    <div className={[styles.root, className ?? ''].filter(Boolean).join(' ')}>
      {title ? <span className={styles.title}>{title}</span> : null}

      <div
        className={styles.track}
        // With a legend the bar is decoration for text that is already on screen; without one it
        // is the only carrier of the numbers and must name itself.
        {...(showLegend ? { 'aria-hidden': true } : { role: 'img', 'aria-label': barName })}
      >
        {entries.map((entry) => (
          <span
            key={entry.key}
            className={styles.segment}
            style={{ ...entry.style, width: entry.width }}
          />
        ))}
        {freeEntry ? (
          <span className={`${styles.segment} ${styles.freeSegment}`} style={{ width: freeEntry.width }} />
        ) : null}
      </div>

      {showLegend ? (
        <ul className={styles.legend} data-columns={columns}>
          {entries.map((entry) => (
            <li key={entry.key} className={styles.item}>
              <span className={styles.swatch} style={entry.style} aria-hidden="true" />
              {entry.caption}
            </li>
          ))}
          {freeEntry ? (
            <li className={`${styles.item} ${styles.itemFree}`}>
              <span className={`${styles.swatch} ${styles.freeSegment}`} aria-hidden="true" />
              {freeEntry.caption}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
