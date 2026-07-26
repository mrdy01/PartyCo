import { Fragment, type ReactElement } from 'react';
import styles from './HistoryStrip.module.css';

/**
 * A short linear history where the **connectors carry the meaning**.
 *
 * The designer introduced this on screen 2.4 as the lease-continuity strip
 * («авторство → expire → reclaim_taken → отправка») and then immediately reused the same grammar
 * for the auto-revert timeline («fast lane → влит → full lane упал → авто-revert»), which has no
 * lease in it at all. So it is named for what it is rather than for where it first appeared — see
 * the note in `docs/design-handoff.md`.
 *
 * The point of the component is the gap: a dashed danger connector between two nodes is the only
 * way to show that a lease was *not* held continuously, or that a merge was undone. A list of
 * timestamps cannot say that, which is why this is not a list.
 */
export type HistoryTone = 'ok' | 'warning' | 'danger' | 'running' | 'neutral';

export interface HistoryConnector {
  tone?: HistoryTone;
  /** Dashed reads as "something is missing here" — continuity broken, work undone. */
  dashed?: boolean;
}

export interface HistoryNode {
  id: string;
  /**
   * `end` nodes are the two ends of the strip: a quiet caption over a value, no dot, text aligned
   * outward. `point` nodes are the events in between: a dot with its name under it. Defaults to
   * `end` for the first and last node and `point` for everything between.
   */
  kind?: 'end' | 'point';
  /** The quiet line — «авторство», «fast lane». */
  caption?: string;
  /** The loud line — «14:02», «expire», «влит b0c19af». */
  label: string;
  tone?: HistoryTone;
  /** The segment that FOLLOWS this node. Ignored on the last node. */
  connector?: HistoryConnector;
}

export interface HistoryStripProps {
  nodes: readonly HistoryNode[];
  /**
   * Accessible name. The strip is a figure, not a list of controls, so it needs one — the visual
   * grammar (dashes, colour) is exactly what a screen reader cannot see.
   */
  label: string;
  /**
   * Spelled-out reading of the strip for assistive tech, when the node labels alone do not carry
   * the point. Omit and the nodes are read in order.
   */
  description?: string;
  className?: string;
}

export function HistoryStrip({
  nodes,
  label,
  description,
  className,
}: HistoryStripProps): ReactElement {
  const last = nodes.length - 1;

  return (
    <figure
      className={className ? `${styles.strip} ${className}` : styles.strip}
      aria-label={label}
    >
      {nodes.map((node, index) => {
        const kind = node.kind ?? (index === 0 || index === last ? 'end' : 'point');
        const connector = node.connector ?? {};
        return (
          <Fragment key={node.id}>
            <span
              className={styles.node}
              data-kind={kind}
              data-align={kind === 'end' ? (index === 0 ? 'start' : 'end') : 'center'}
              data-tone={node.tone ?? 'neutral'}
            >
              {kind === 'point' ? <span className={styles.dot} aria-hidden="true" /> : null}
              {node.caption ? <span className={styles.caption}>{node.caption}</span> : null}
              <span className={styles.label}>{node.label}</span>
            </span>
            {index === last ? null : (
              <span
                className={styles.connector}
                data-tone={connector.tone ?? 'neutral'}
                data-dashed={connector.dashed ? 'true' : undefined}
                aria-hidden="true"
              />
            )}
          </Fragment>
        );
      })}
      {description ? <figcaption className={styles.srOnly}>{description}</figcaption> : null}
    </figure>
  );
}
