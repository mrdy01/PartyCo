import { useCallback, useMemo, useRef, type KeyboardEvent } from 'react';
import type { IdentitySetName } from '@partyco/tokens';
import { identityGutterVar, type Member } from '../../identity.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tab, type TabKind } from '../Tab/Tab.tsx';
import styles from './Tabs.module.css';

export interface TabItem {
  id: string;
  /** Visible label. Russian, comes from data. */
  label: string;
  kind?: TabKind | undefined;
  /** `id` of the member holding the lease on the zone this tab's content lives in. */
  zoneOwnerId?: string | undefined;
  /** Live work behind the tab — pulsing running dot. */
  running?: boolean | undefined;
  disabled?: boolean | undefined;
  /** This tab may be closed (Delete/Backspace, middle click). Requires `onClose`. */
  closable?: boolean | undefined;
  /** `id` of the panel this tab controls. */
  controls?: string | undefined;
}

/**
 * The strip below the tabs saying "you cannot type here, this belongs to somebody else".
 * Tinted with the owner's identity colour at gutter strength — identity role #3.
 */
export interface TabsZoneNotice {
  /** `id` of the member who holds the zone. */
  ownerId: string;
  /**
   * Explanation shown to the user. Defaults to a generic sentence; pass a declined variant
   * («Этот файл в зоне Марины…») when the caller knows the grammar.
   */
  message?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  /** `id` of the active tab. Controlled — `Tabs` keeps no selection state of its own. */
  activeId: string;
  onSelect: (id: string) => void;
  onClose?: ((id: string) => void) | undefined;
  /** Everyone who might own a zone; used to resolve `zoneOwnerId`. */
  members?: readonly Member[] | undefined;
  identitySet?: IdentitySetName | undefined;
  zoneNotice?: TabsZoneNotice | undefined;
  /** When provided, the «+» control appears at the end of the strip. */
  onNewTab?: (() => void) | undefined;
  newTabLabel?: string | undefined;
  /** Accessible name of the strip. */
  ariaLabel?: string | undefined;
}

/**
 * The editor tab strip. Spec §"Табы · точка = файл в чужой зоне".
 *
 * Arrow keys move the selection (selection follows focus, as the tabs pattern prescribes),
 * Home/End jump to the ends, Delete/Backspace close a closable tab.
 */
export function Tabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  members,
  identitySet,
  zoneNotice,
  onNewTab,
  newTabLabel = 'Новый таб',
  ariaLabel = 'Открытые табы',
}: TabsProps): React.ReactElement {
  const byId = useMemo(() => {
    const map = new Map<string, Member>();
    for (const member of members ?? []) map.set(member.id, member);
    return map;
  }, [members]);

  const refs = useRef(new Map<string, HTMLButtonElement>());

  const step = useCallback(
    (from: number, delta: number): void => {
      if (tabs.length === 0) return;
      for (let i = 1; i <= tabs.length; i += 1) {
        const next = tabs[(from + delta * i + tabs.length * i) % tabs.length];
        if (!next || next.disabled) continue;
        onSelect(next.id);
        refs.current.get(next.id)?.focus();
        return;
      }
    },
    [onSelect, tabs],
  );

  const edge = useCallback(
    (fromStart: boolean): void => {
      const ordered = fromStart ? tabs : [...tabs].reverse();
      const next = ordered.find((t) => !t.disabled);
      if (!next) return;
      onSelect(next.id);
      refs.current.get(next.id)?.focus();
    },
    [onSelect, tabs],
  );

  const handleKeyDown = useCallback(
    (index: number, tab: TabItem) => (event: KeyboardEvent<HTMLButtonElement>): void => {
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          step(index, 1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          step(index, -1);
          break;
        case 'Home':
          event.preventDefault();
          edge(true);
          break;
        case 'End':
          event.preventDefault();
          edge(false);
          break;
        case 'Delete':
        case 'Backspace':
          if (tab.closable && onClose) {
            event.preventDefault();
            onClose(tab.id);
          }
          break;
        default:
          break;
      }
    },
    [edge, onClose, step],
  );

  const noticeOwner = zoneNotice ? byId.get(zoneNotice.ownerId) : undefined;

  return (
    <div className={styles.root}>
      <div className={styles.strip}>
        <div className={styles.list} role="tablist" aria-label={ariaLabel} aria-orientation="horizontal">
          {tabs.map((tab, index) => {
            const active = tab.id === activeId;
            const owner = tab.zoneOwnerId ? byId.get(tab.zoneOwnerId) : undefined;
            return (
              <Tab
                key={tab.id}
                ref={(el) => {
                  if (el) refs.current.set(tab.id, el);
                  else refs.current.delete(tab.id);
                }}
                label={tab.label}
                kind={tab.kind}
                active={active}
                disabled={tab.disabled}
                running={tab.running}
                zoneOwner={owner}
                identitySet={identitySet}
                controls={tab.controls}
                tabIndex={active ? 0 : -1}
                onSelect={() => onSelect(tab.id)}
                onClose={tab.closable && onClose ? () => onClose(tab.id) : undefined}
                onKeyDown={handleKeyDown(index, tab)}
              />
            );
          })}
        </div>
        {onNewTab ? (
          <button type="button" className={styles.newTab} aria-label={newTabLabel} title={newTabLabel} onClick={onNewTab}>
            {/* The icon set has no «plus» glyph, so the affordance is typographic. */}
            <span aria-hidden="true">+</span>
          </button>
        ) : null}
      </div>

      {zoneNotice && noticeOwner ? (
        <div
          className={styles.notice}
          role="status"
          // Identity role: the owner's colour at gutter strength, never a solid fill.
          style={{ background: identityGutterVar(noticeOwner.colorSlug, identitySet) }}
        >
          {/* The owner's name is in the sentence next to it, so the chip is decorative. */}
          <Avatar member={noticeOwner} size="xs" identitySet={identitySet} decorative />
          <span className={styles.noticeText}>
            {zoneNotice.message ??
              `Этот файл в зоне участника ${noticeOwner.name}. Редактирование заблокировано — можно читать и предложить правку.`}
          </span>
          {zoneNotice.onAction ? (
            <button type="button" className={styles.noticeAction} onClick={zoneNotice.onAction}>
              {zoneNotice.actionLabel ?? 'Запросить зону'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
