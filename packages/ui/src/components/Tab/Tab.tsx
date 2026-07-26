import type { KeyboardEvent, MouseEvent, Ref } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { identityVar, type Member } from '../../identity.ts';
import styles from './Tab.module.css';

/**
 * What the tab is showing. Drives the glyph and nothing else — a tab never changes its geometry
 * because of its kind.
 */
export type TabKind = 'editor' | 'diff' | 'terminal' | 'agent';

const KIND_ICON: Record<TabKind, IconName> = {
  editor: 'file',
  diff: 'diff',
  terminal: 'terminal',
  agent: 'agent',
};

export interface TabProps {
  /** Visible label. Russian, comes from data (file name, «Дифф · ledger.ts», «Терминал»…). */
  label: string;
  kind?: TabKind | undefined;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  /**
   * The member who holds the lease on the zone this tab's content lives in — set only when that
   * member is somebody else. Renders the coloured dot and tints the active edge: identity colour,
   * not status colour.
   */
  zoneOwner?: Member | undefined;
  identitySet?: IdentitySetName | undefined;
  /** Live work behind this tab (agent thinking, tests running). Adds the pulsing running dot. */
  running?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  /**
   * Close this tab. Triggered by the middle mouse button here and by Delete/Backspace in `Tabs`;
   * the design shows no × affordance, so none is invented.
   */
  onClose?: (() => void) | undefined;
  /** Label for the identity dot, read out instead of the bare colour. */
  zoneHint?: string | undefined;
  /** Label for the running dot. */
  runningHint?: string | undefined;
  id?: string | undefined;
  /** `id` of the panel this tab controls. */
  controls?: string | undefined;
  tabIndex?: number | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLButtonElement>) => void) | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

/**
 * One tab in the editor strip. Spec §"Табы · точка = файл в чужой зоне": the dot is the whole
 * point — it says the thing behind this tab sits inside another member's zone, and it carries that
 * member's identity colour so the answer to "whose?" needs no click.
 */
export function Tab({
  label,
  kind = 'editor',
  active = false,
  disabled = false,
  zoneOwner,
  identitySet,
  running = false,
  onSelect,
  onClose,
  zoneHint = 'В чужой зоне',
  runningHint = 'Идёт работа',
  id,
  controls,
  tabIndex,
  onKeyDown,
  ref,
}: TabProps): React.ReactElement {
  const ownerColor = zoneOwner ? identityVar(zoneOwner.colorSlug, identitySet) : null;

  const className = [
    styles.tab,
    active ? styles.active : '',
    running ? styles.running : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Middle click closes, the way every editor does it.
  const handleAuxClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.button !== 1 || !onClose) return;
    event.preventDefault();
    onClose();
  };

  return (
    <button
      type="button"
      role="tab"
      id={id}
      ref={ref}
      className={className}
      aria-selected={active}
      aria-disabled={disabled || undefined}
      aria-controls={controls}
      tabIndex={tabIndex}
      disabled={disabled}
      aria-keyshortcuts={onClose ? 'Delete' : undefined}
      onClick={onSelect}
      onAuxClick={handleAuxClick}
      onKeyDown={onKeyDown}
      // Identity role: the 2px edge that marks whose zone this is, here on the tab's top side.
      style={active && ownerColor ? { borderTopColor: ownerColor } : undefined}
    >
      <Icon name={KIND_ICON[kind]} className={styles.glyph} />
      <span className={styles.label}>{label}</span>
      {zoneOwner ? (
        <span
          className={styles.dot}
          title={`${zoneHint}: ${zoneOwner.name}`}
          aria-label={`${zoneHint}: ${zoneOwner.name}`}
          role="img"
          style={{ background: identityVar(zoneOwner.colorSlug, identitySet) }}
        />
      ) : null}
      {running ? (
        <span
          className={`${styles.dot} ${styles.dotRunning}`}
          title={runningHint}
          aria-label={runningHint}
          role="img"
        />
      ) : null}
    </button>
  );
}
