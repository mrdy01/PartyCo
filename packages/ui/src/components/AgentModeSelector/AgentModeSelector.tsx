import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Icon, type IconName } from '@partyco/icons';
import styles from './AgentModeSelector.module.css';

/**
 * The three agent modes. Fixed by the architecture doc (§ "режимы Plan / Accept edits / Auto") and
 * by the protocol — never derive this list from the UI.
 */
export type AgentMode = 'plan' | 'accept-edits' | 'auto';

/** Canonical order: least authority first. The selector never reorders it. */
export const AGENT_MODES: readonly AgentMode[] = ['plan', 'accept-edits', 'auto'];

export const AGENT_MODE_LABEL: Record<AgentMode, string> = {
  plan: 'План',
  'accept-edits': 'Приём правок',
  auto: 'Авто',
};

/** Shortened label for the narrow first column of the `bars` variant. */
export const AGENT_MODE_SHORT_LABEL: Record<AgentMode, string> = {
  plan: 'План',
  'accept-edits': 'Приём',
  auto: 'Авто',
};

/** What the mode allows, one word — shown on the inactive bars. */
export const AGENT_MODE_ALLOWANCE: Record<AgentMode, string> = {
  plan: 'читает',
  'accept-edits': 'пишет',
  auto: 'всё',
};

/** What the mode allows, spelled out — shown on the active bar and in the menu. */
export const AGENT_MODE_ALLOWANCE_FULL: Record<AgentMode, string> = {
  plan: 'только предлагает',
  'accept-edits': 'пишет в своей зоне',
  auto: 'пишет · запускает · правит',
};

/** Scope hint for the compact variant — the one-glance answer to "что он может прямо сейчас". */
export const AGENT_MODE_SCOPE: Record<AgentMode, string> = {
  plan: 'только чтение',
  'accept-edits': 'в моей зоне',
  auto: 'пишет и запускает',
};

export const AGENT_MODE_ICON: Record<AgentMode, IconName> = {
  plan: 'search',
  'accept-edits': 'check',
  auto: 'run',
};

/** True for the modes that let the agent act without a human confirming each step. */
export function isAutonomous(mode: AgentMode): boolean {
  return mode === 'auto';
}

export type AgentModeSelectorVariant = 'segmented' | 'compact' | 'bars';

export interface AgentModeSelectorProps {
  /** Currently active mode. Controlled — the session owns this value. */
  value: AgentMode;
  /**
   * Switches the mode. Omit it and the selector stops being one: the same three rows are drawn as a
   * read-out of what the agent may do right now — no radio semantics, no tab stops, no hover, no
   * menu and no «переключение ⇧Tab» hint. Mode is the most consequential thing on the session
   * surface, and a control that looks like it can lower the agent's authority but cannot is worse
   * than a label that never promised to.
   */
  onChange?: (mode: AgentMode) => void;
  /**
   * `segmented` — all three always visible (design A).
   * `compact` — one button carrying the mode colour in its own edge, menu on click (design B).
   * `bars` — allowance bars, the active one grows and marches (design C, the recommended one).
   */
  variant?: AgentModeSelectorVariant;
  /** Modes the current policy or lease set does not permit. Still visible, never hidden. */
  disabledModes?: readonly AgentMode[];
  /** Disables the whole control, e.g. while a turn is in flight. */
  disabled?: boolean;
  /** Overrides for the mode names. */
  labels?: Partial<Record<AgentMode, string>>;
  /** Group label for assistive tech. */
  label?: string;
  /** Keyboard hint under the `segmented` and `compact` variants. Pass `null` to hide. */
  shortcutLabel?: string | null;
  /** Keys shown as `<kbd>` chips next to `shortcutLabel`. */
  shortcutKeys?: readonly string[];
  className?: string;
}

/**
 * Mode selector. Requirement from the design: "режим виден через комнату" — hence the mode colour
 * (blue = plan, neutral = accept edits, amber = auto) plus, for `auto`, a persistent pulsing dot and
 * marching hatch so an autonomous session can never be mistaken for a supervised one.
 */
export function AgentModeSelector({
  value,
  onChange,
  variant = 'bars',
  disabledModes,
  disabled = false,
  labels,
  label = 'Режим агента',
  shortcutLabel = 'переключение',
  shortcutKeys = ['⇧', 'Tab'],
  className,
}: AgentModeSelectorProps): ReactElement {
  const buttons = useRef(new Map<AgentMode, HTMLButtonElement | null>());

  /** Nothing to call ⇒ nothing to press. See the note on `onChange`. */
  const interactive = Boolean(onChange);

  const nameOf = useCallback(
    (mode: AgentMode) => labels?.[mode] ?? AGENT_MODE_LABEL[mode],
    [labels],
  );
  const isBlocked = useCallback(
    (mode: AgentMode) => disabled || (disabledModes?.includes(mode) ?? false),
    [disabled, disabledModes],
  );

  const select = useCallback(
    (mode: AgentMode) => {
      if (isBlocked(mode) || mode === value) return;
      onChange?.(mode);
    },
    [isBlocked, onChange, value],
  );

  /** Radio-group semantics: arrows move the selection and skip modes policy forbids. */
  const step = useCallback(
    (direction: 1 | -1) => {
      const open = AGENT_MODES.filter((m) => !isBlocked(m));
      if (open.length === 0) return;
      const at = open.indexOf(value);
      const next = open[(at + direction + open.length) % open.length];
      if (!next) return;
      select(next);
      buttons.current.get(next)?.focus();
    },
    [isBlocked, select, value],
  );

  const edge = useCallback(
    (which: 'first' | 'last') => {
      const open = AGENT_MODES.filter((m) => !isBlocked(m));
      const next = which === 'first' ? open[0] : open[open.length - 1];
      if (!next) return;
      select(next);
      buttons.current.get(next)?.focus();
    },
    [isBlocked, select],
  );

  const onGroupKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          step(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          step(-1);
          break;
        case 'Home':
          event.preventDefault();
          edge('first');
          break;
        case 'End':
          event.preventDefault();
          edge('last');
          break;
        default:
          break;
      }
    },
    [edge, step],
  );

  const register = (mode: AgentMode) => (node: HTMLButtonElement | null) => {
    buttons.current.set(mode, node);
  };

  /** The inside of one allowance bar — identical whether the bar is a button or a read-out. */
  const barBody = (mode: AgentMode, active: boolean): ReactElement => (
    <>
      <span className={styles.barName}>
        {active && isAutonomous(mode) ? <span className={styles.dot} /> : null}
        <span className={styles.barNameText}>{AGENT_MODE_SHORT_LABEL[mode]}</span>
      </span>
      <span className={styles.track} aria-hidden="true" />
      <span className={styles.barAllowance}>
        {active ? AGENT_MODE_ALLOWANCE_FULL[mode] : AGENT_MODE_ALLOWANCE[mode]}
      </span>
    </>
  );

  /** Same for one segment. */
  const segmentBody = (mode: AgentMode, active: boolean): ReactElement => (
    <>
      <Icon name={AGENT_MODE_ICON[mode]} className={styles.icon} />
      {nameOf(mode)}
      {active && isAutonomous(mode) ? <span className={styles.dotOnFill} /> : null}
    </>
  );

  if (variant === 'compact') {
    return (
      <CompactSelector
        value={value}
        nameOf={nameOf}
        isBlocked={isBlocked}
        select={select}
        label={label}
        disabled={disabled}
        interactive={interactive}
        shortcutLabel={shortcutLabel}
        shortcutKeys={shortcutKeys}
        className={className}
      />
    );
  }

  if (variant === 'bars') {
    /*
     * The read-out. `role="group"` and not `radiogroup`: a radio group announces itself as a choice,
     * and there is no choice here. The active row is marked with `aria-current` so the fact still
     * reaches assistive tech, and a mode policy forbids stays visible and dimmed — hiding what the
     * agent may not do would be the one thing worse than showing it greyed.
     */
    if (!interactive) {
      return (
        <div
          className={className ? `${styles.bars} ${className}` : styles.bars}
          role="group"
          aria-label={label}
          data-active-mode={value}
        >
          {AGENT_MODES.map((mode) => {
            const active = mode === value;
            return (
              <span
                key={mode}
                className={styles.bar}
                data-mode={mode}
                data-static="true"
                data-active={active || undefined}
                data-blocked={isBlocked(mode) || undefined}
                {...(active ? { 'aria-current': 'true' as const } : {})}
              >
                {barBody(mode, active)}
              </span>
            );
          })}
        </div>
      );
    }

    return (
      <div
        className={className ? `${styles.bars} ${className}` : styles.bars}
        role="radiogroup"
        aria-label={label}
        data-active-mode={value}
        onKeyDown={onGroupKeyDown}
      >
        {AGENT_MODES.map((mode) => {
          const active = mode === value;
          const blocked = isBlocked(mode);
          return (
            <button
              key={mode}
              ref={register(mode)}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${nameOf(mode)} — ${active ? AGENT_MODE_ALLOWANCE_FULL[mode] : AGENT_MODE_ALLOWANCE[mode]}`}
              tabIndex={active ? 0 : -1}
              disabled={blocked}
              className={styles.bar}
              data-mode={mode}
              data-active={active || undefined}
              onClick={() => select(mode)}
            >
              {barBody(mode, active)}
            </button>
          );
        })}
      </div>
    );
  }

  if (!interactive) {
    return (
      <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
        <div className={styles.segmented} role="group" aria-label={label} data-active-mode={value}>
          {AGENT_MODES.map((mode) => {
            const active = mode === value;
            return (
              <span
                key={mode}
                className={styles.segment}
                data-mode={mode}
                data-static="true"
                data-active={active || undefined}
                data-blocked={isBlocked(mode) || undefined}
                {...(active ? { 'aria-current': 'true' as const } : {})}
              >
                {segmentBody(mode, active)}
              </span>
            );
          })}
        </div>
        {/* No hint either: «переключение ⇧Tab» over something that never switches is a third lie. */}
      </div>
    );
  }

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <div
        className={styles.segmented}
        role="radiogroup"
        aria-label={label}
        data-active-mode={value}
        onKeyDown={onGroupKeyDown}
      >
        {AGENT_MODES.map((mode) => {
          const active = mode === value;
          const blocked = isBlocked(mode);
          return (
            <button
              key={mode}
              ref={register(mode)}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              disabled={blocked}
              className={styles.segment}
              data-mode={mode}
              data-active={active || undefined}
              onClick={() => select(mode)}
            >
              {segmentBody(mode, active)}
            </button>
          );
        })}
      </div>
      <ShortcutHint label={shortcutLabel} keys={shortcutKeys} />
    </div>
  );
}

interface CompactSelectorProps {
  value: AgentMode;
  nameOf: (mode: AgentMode) => string;
  isBlocked: (mode: AgentMode) => boolean;
  select: (mode: AgentMode) => void;
  label: string;
  disabled: boolean;
  /** False when the parent has no `onChange`; then there is no trigger, no chevron and no menu. */
  interactive: boolean;
  shortcutLabel: string | null;
  shortcutKeys: readonly string[];
  className: string | undefined;
}

/** Design B — a single button that carries the mode colour in its own left edge, plus a menu. */
function CompactSelector({
  value,
  nameOf,
  isBlocked,
  select,
  label,
  disabled,
  interactive,
  shortcutLabel,
  shortcutKeys,
  className,
}: CompactSelectorProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<AgentMode>(value);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef(new Map<AgentMode, HTMLButtonElement | null>());

  useEffect(() => {
    if (!open) return;
    items.current.get(focused)?.focus();
  }, [open, focused]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  const openMenu = () => {
    if (disabled) return;
    setFocused(value);
    setOpen(true);
  };

  const moveFocus = (direction: 1 | -1) => {
    const open_ = AGENT_MODES.filter((m) => !isBlocked(m));
    if (open_.length === 0) return;
    const at = open_.indexOf(focused);
    const next = open_[(at + direction + open_.length) % open_.length];
    if (next) setFocused(next);
  };

  /*
   * The read-out. The chip keeps the mode colour in its left edge — that is a fact about the
   * session, and the whole reason design B exists — and loses the `▾`, the `aria-haspopup`, the tab
   * stop and the hover. A menu marker over a menu that cannot change anything is exactly the arrow
   * the composer's mode chip used to draw.
   */
  if (!interactive) {
    return (
      <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
        <div className={styles.compactWrap} role="group" aria-label={label}>
          <span
            className={styles.compact}
            data-mode={value}
            data-static="true"
            data-blocked={disabled || undefined}
          >
            <span className={styles.compactName}>
              {isAutonomous(value) ? <span className={styles.dot} /> : null}
              <span className={styles.compactNameText}>{nameOf(value)}</span>
            </span>
            <span className={styles.compactScope}>{AGENT_MODE_SCOPE[value]}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <div className={styles.compactWrap} ref={root}>
        <button
          ref={trigger}
          type="button"
          className={styles.compact}
          data-mode={value}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${label}: ${nameOf(value)}`}
          disabled={disabled}
          onClick={() => (open ? close(false) : openMenu())}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              openMenu();
            }
          }}
        >
          <span className={styles.compactName}>
            {isAutonomous(value) ? <span className={styles.dot} /> : null}
            <span className={styles.compactNameText}>{nameOf(value)}</span>
          </span>
          <span className={styles.compactScope}>{AGENT_MODE_SCOPE[value]}</span>
          <span className={styles.chevron} aria-hidden="true">
            ▾
          </span>
        </button>
        {open ? (
          <div
            className={styles.menu}
            role="menu"
            aria-label={label}
            onKeyDown={(event) => {
              switch (event.key) {
                case 'Escape':
                  event.preventDefault();
                  close(true);
                  break;
                case 'ArrowDown':
                  event.preventDefault();
                  moveFocus(1);
                  break;
                case 'ArrowUp':
                  event.preventDefault();
                  moveFocus(-1);
                  break;
                case 'Tab':
                  close(false);
                  break;
                default:
                  break;
              }
            }}
          >
            {AGENT_MODES.map((mode) => (
              <button
                key={mode}
                ref={(node) => {
                  items.current.set(mode, node);
                }}
                type="button"
                role="menuitemradio"
                aria-checked={mode === value}
                tabIndex={mode === focused ? 0 : -1}
                disabled={isBlocked(mode)}
                className={styles.menuItem}
                data-mode={mode}
                data-active={mode === value || undefined}
                onClick={() => {
                  select(mode);
                  close(true);
                }}
              >
                <span className={styles.menuName}>{nameOf(mode)}</span>
                <span className={styles.menuAllowance}>{AGENT_MODE_ALLOWANCE_FULL[mode]}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <ShortcutHint label={shortcutLabel} keys={shortcutKeys} />
    </div>
  );
}

function ShortcutHint({
  label,
  keys,
}: {
  label: string | null;
  keys: readonly string[];
}): ReactElement | null {
  if (!label) return null;
  return (
    <span className={styles.hint}>
      <span>{label}</span>
      <span className={styles.keys}>
        {keys.map((key) => (
          <kbd key={key} className={styles.kbd}>
            {key}
          </kbd>
        ))}
      </span>
    </span>
  );
}
