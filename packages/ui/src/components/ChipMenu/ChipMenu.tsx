import { useEffect, useRef, type ReactElement } from 'react';
import styles from './ChipMenu.module.css';

/**
 * The small menu a composer chip opens.
 *
 * It exists because of the rule the composer chips are the last violation of: a chevron is a promise
 * that something opens, and the two chips draw one. `Composer` already owns the slot, the outside
 * click and the Escape key; this is only the list that goes in it.
 *
 * Deliberately not `ModelPicker` and not `AgentModeSelector`. `ModelPicker` is the designer's
 * command palette — centred, elevated, searchable, with a context window and a price per million
 * tokens against every row. That surface is right for sixty models across five vendors; it is
 * theatre over the four aliases a vendor actually documents, and its `costLabel` is a required prop
 * we could only fill by inventing a claim about somebody's billing. `AgentModeSelector` is the
 * designer's 238px allowance bars, which cannot live in a 24px chip row. Both stay where they are,
 * unchanged, for the surfaces they were drawn for.
 *
 * **A disabled row keeps its reason on screen, as text.** Not a `title`: a disabled button never
 * receives hover in any browser, so a tooltip is invisible to precisely the person who needs it —
 * and «выключено без объяснения» is the open question §8.17 already records against the other
 * selector. A row that cannot be chosen still has to say what is missing.
 */

export interface ChipMenuItem {
  /** Stable value handed back to `onSelect`. */
  value: string;
  label: string;
  /** One line under the label: what this choice means, not what it is called. */
  note?: string | undefined;
  /**
   * Why this row cannot be chosen. Present ⇒ the row is inert **and** says this out loud.
   *
   * A row with a reason is drawn, not hidden. Hiding it is honest and mute — the person never learns
   * that the choice exists or what would unlock it, which is how «почему тут только два режима?»
   * becomes a support question instead of a sentence they already read.
   */
  disabledReason?: string | undefined;
  /** Status dot, when the choice carries one. The mode menu uses it; the model menu does not. */
  tone?: 'success' | 'warning' | 'danger' | undefined;
}

export interface ChipMenuProps {
  /** Accessible name of the group — what is being chosen. */
  label: string;
  items: readonly ChipMenuItem[];
  /** The value currently in force. May be absent when nothing is chosen yet. */
  selected?: string | undefined;
  onSelect: (value: string) => void;
  /** Called after a successful pick, and by the caller's own Escape handling. */
  onClose: () => void;
  /**
   * A sentence above the rows, for the case where the whole menu is the answer.
   *
   * Used when a provider accepts none of the choices: the rows are all disabled and this says why
   * once, instead of repeating the same reason three times.
   */
  note?: string | undefined;
  className?: string | undefined;
}

export function ChipMenu({
  label,
  items,
  selected,
  onSelect,
  onClose,
  note,
  className,
}: ChipMenuProps): ReactElement {
  const listRef = useRef<HTMLDivElement>(null);

  /*
   * Focus opens on the row in force, so the first arrow key moves from where the person already is.
   * Landing on row one instead would mean «Авто» is one key away from a member who is on «План»,
   * which is the wrong default for the control that decides whether files get written.
   */
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const current = [...rows].find((row) => row.dataset['selected'] === 'true');
    (current ?? rows[0])?.focus();
  }, []);

  const move = (from: HTMLButtonElement, delta: number): void => {
    const root = listRef.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = rows.indexOf(from);
    if (at === -1) return;
    // Wraps, because a list this short has no meaningful "end" and stopping dead at one reads as a
    // key that failed rather than as a boundary.
    rows[(at + delta + rows.length) % rows.length]?.focus();
  };

  return (
    <div
      ref={listRef}
      className={[styles.root, className].filter(Boolean).join(' ')}
      role="menu"
      aria-label={label}
    >
      {note ? <p className={styles.note}>{note}</p> : null}
      {items.map((item) => {
        const blocked = item.disabledReason !== undefined;
        const isSelected = selected !== undefined && item.value === selected;
        return (
          <button
            key={item.value}
            type="button"
            role="menuitemradio"
            aria-checked={isSelected}
            className={styles.row}
            data-selected={isSelected ? 'true' : undefined}
            disabled={blocked}
            onClick={() => {
              if (blocked) return;
              onSelect(item.value);
              onClose();
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                move(event.currentTarget, 1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                move(event.currentTarget, -1);
              }
            }}
          >
            <span className={styles.dot} data-tone={item.tone} aria-hidden="true" />
            <span className={styles.body}>
              <span className={styles.label}>{item.label}</span>
              {item.note ? <span className={styles.itemNote}>{item.note}</span> : null}
              {item.disabledReason ? (
                <span className={styles.reason}>{item.disabledReason}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
