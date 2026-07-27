import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import { SearchField } from '../SearchField/SearchField.tsx';
import s from './ShellTitleBar.module.css';

/**
 * The three strings the bar says out loud. Two of them are invisible — the switcher and the field
 * carry no visible label in the design, so these ARE their accessible names.
 */
export interface ShellTitleBarLabels {
  /** Accessible name of the project switcher chip. */
  projectSwitcher: string;
  /** Accessible name of the search field. */
  search: string;
  searchPlaceholder: string;
}

export const SHELL_TITLE_BAR_LABELS: ShellTitleBarLabels = {
  projectSwitcher: 'Сменить проект',
  search: 'Поиск по проекту',
  /* No ellipsis: the designer dropped it everywhere in this revision. */
  searchPlaceholder: 'Найти файл, задачу, участника',
};

export interface ShellTitleBarProps {
  /** Project display name, e.g. «Хайтейл». */
  projectName: string;
  /** Omit and the chip is the project's name without a caret — nothing opens, so nothing offers to. */
  onProjectSwitch?: (() => void) | undefined;
  searchValue?: string | undefined;
  /**
   * Where a query goes. With neither this nor `onSearchSubmit` the field is not rendered at all: an
   * input that swallows what a person types is a control that lies twice over.
   */
  onSearchChange?: ((value: string) => void) | undefined;
  onSearchSubmit?: ((value: string) => void) | undefined;
  /**
   * Keycaps for the shortcut that focuses search, e.g. `['Ctrl', 'K']`. The bar binds them itself —
   * drawing a keycap it does not listen for would be a promise nobody keeps. Pass `[]` for none.
   */
  searchShortcut?: readonly string[] | undefined;
  /**
   * Space kept clear at the trailing edge for the window buttons the OS paints on top of this bar.
   * On Windows the app runs with Electron's `titleBarOverlay`, so those buttons are native and this
   * bar deliberately draws none of its own. 140px matches the overlay width the main process asks
   * for; the export marks the same strip with a dashed rule and the caption `titleBarOverlay`.
   */
  reservedControlsWidth?: number | undefined;
  labels?: Partial<ShellTitleBarLabels> | undefined;
  className?: string | undefined;
}

const DEFAULT_RESERVED_CONTROLS_WIDTH = 140;

/** Stable identity so the shortcut listener does not re-subscribe on every render. */
const DEFAULT_SEARCH_SHORTCUT: readonly string[] = ['Ctrl', 'K'];

/**
 * Keycaps that name a modifier rather than a key. The last cap in the list is the key itself; the
 * ones before it are what has to be held down.
 */
const SHORTCUT_MODIFIERS: Record<string, 'command' | 'shift' | 'alt'> = {
  ctrl: 'command',
  control: 'command',
  cmd: 'command',
  meta: 'command',
  '⌘': 'command',
  shift: 'shift',
  '⇧': 'shift',
  alt: 'alt',
  opt: 'alt',
  option: 'alt',
  '⌥': 'alt',
};

/**
 * Does this keypress match the caps drawn in the field?
 *
 * `Ctrl` and `⌘` are the same intention on two platforms — the design draws whichever the OS uses —
 * so either physical modifier satisfies a `command` cap. Every modifier is matched exactly, in both
 * directions: `Ctrl K` must not fire on `Ctrl Shift K`, which usually belongs to something else.
 */
function matchesShortcut(keys: readonly string[], event: KeyboardEvent): boolean {
  const caps = keys.map((key) => key.toLowerCase());
  const final = caps[caps.length - 1];
  if (final === undefined || SHORTCUT_MODIFIERS[final] !== undefined) return false;
  if (event.key.toLowerCase() !== final) return false;

  const wanted = new Set(
    caps.slice(0, -1).map((cap) => SHORTCUT_MODIFIERS[cap] ?? 'unknown'),
  );
  if (wanted.has('unknown')) return false;
  if (wanted.has('command') !== (event.ctrlKey || event.metaKey)) return false;
  if (wanted.has('shift') !== event.shiftKey) return false;
  if (wanted.has('alt') !== event.altKey) return false;
  return true;
}

/**
 * Field-by-field merge, not `{ ...DEFAULT, ...labels }`.
 *
 * With `exactOptionalPropertyTypes` a caller may still hand over `{ search: undefined }`, and the
 * spread form would happily write that `undefined` over the default — which is how a partial
 * override once wiped a whole block of copy in this codebase.
 */
function mergeLabels(labels: Partial<ShellTitleBarLabels> | undefined): ShellTitleBarLabels {
  if (!labels) return SHELL_TITLE_BAR_LABELS;
  return {
    projectSwitcher: labels.projectSwitcher ?? SHELL_TITLE_BAR_LABELS.projectSwitcher,
    search: labels.search ?? SHELL_TITLE_BAR_LABELS.search,
    searchPlaceholder: labels.searchPlaceholder ?? SHELL_TITLE_BAR_LABELS.searchPlaceholder,
  };
}

/**
 * The shell's 36px window strip: identity mark, project switcher, one centred search field, and a
 * reserved strip where the OS draws its own window buttons.
 *
 * What is NOT here is the point of the revision. The theme and density toggles the operator's
 * title bar carries are gone — «это настройка, а не инструмент», and settings have a rail item of
 * their own. Search stays because it is the one thing a person needs from anywhere.
 *
 * `AppTitleBar` is not forked and not replaced: it keeps serving the three original screens, which
 * still show a breadcrumb and still own the chrome toggles.
 *
 * Drag region: the root carries the host app's `pc-titlebar` class AND declares the drag region
 * itself, so the window still moves when the bar is rendered somewhere that global stylesheet is
 * not loaded (the hub app, a test harness). Every interactive child opts back out via
 * `data-no-drag`, or its click would be swallowed by the window move.
 */
export function ShellTitleBar({
  projectName,
  onProjectSwitch,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  searchShortcut = DEFAULT_SEARCH_SHORTCUT,
  reservedControlsWidth = DEFAULT_RESERVED_CONTROLS_WIDTH,
  labels,
  className,
}: ShellTitleBarProps): ReactElement {
  const text = mergeLabels(labels);
  const reserve: CSSProperties = { paddingInlineEnd: `${reservedControlsWidth}px` };
  const switcherName = `${text.projectSwitcher} · ${projectName}`;

  /**
   * Typing has to reach somebody. A field that accepts a query and answers none is the worst shape
   * a dead control can take — the text appears, so it looks like it worked.
   */
  const canSearch = Boolean(onSearchChange ?? onSearchSubmit);

  const barRef = useRef<HTMLElement>(null);
  /* Joined, so an inline `['Ctrl', 'K']` from the caller does not re-subscribe on every render. */
  const shortcutKey = searchShortcut ? searchShortcut.join('+') : '';

  /**
   * The keycaps drawn in the field are a promise, and this is where it is kept — nothing outside
   * could keep it, because the input this focuses is not exposed to the caller.
   *
   * The listener is on `window` the way `CommandPalette` keeps its own `⌘K`. It exists only while
   * the field does: no field, no caps, no shortcut.
   */
  useEffect(() => {
    if (!canSearch || shortcutKey === '') return;
    const keys = shortcutKey.split('+');
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!matchesShortcut(keys, event)) return;
      const field = barRef.current?.querySelector<HTMLInputElement>('input[type="search"]');
      if (!field) return;
      event.preventDefault();
      field.focus();
      field.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSearch, shortcutKey]);

  return (
    <header
      ref={barRef}
      className={['pc-titlebar', s.bar, className].filter(Boolean).join(' ')}
      style={reserve}
      data-app-region="drag"
    >
      <span className={s.logo} aria-hidden="true">
        <span className={s.pip} data-pip="a" />
        <span className={s.pip} data-pip="b" />
        <span className={s.pip} data-pip="c" />
      </span>

      {/*
       * A chip only while there is somewhere to go. Without `onProjectSwitch` the name stays and
       * everything that promised a menu goes: the caret, the pointer cursor, the hover fill and the
       * tab stop. A chevron over a name that opens nothing is the same lie the composer's mode chip
       * used to tell.
       */}
      {onProjectSwitch ? (
        <button
          type="button"
          className={s.project}
          data-no-drag="true"
          onClick={onProjectSwitch}
          aria-label={switcherName}
          title={switcherName}
        >
          <span className={s.projectName}>{projectName}</span>
          <Icon name="caret-down" className={s.caret} />
        </button>
      ) : (
        <span className={s.project} data-static="true">
          <span className={s.projectName}>{projectName}</span>
        </span>
      )}

      {/* No listener, no field — see `canSearch`. */}
      {canSearch ? (
        <SearchField
          dense
          className={s.search}
          label={text.search}
          placeholder={text.searchPlaceholder}
          shortcut={searchShortcut}
          onValueChange={onSearchChange}
          onSubmit={onSearchSubmit}
          {...(searchValue !== undefined ? { value: searchValue } : {})}
        />
      ) : null}
    </header>
  );
}
