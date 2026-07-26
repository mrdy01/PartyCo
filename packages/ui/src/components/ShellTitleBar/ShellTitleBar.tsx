import type { CSSProperties, ReactElement } from 'react';
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
  onProjectSwitch?: (() => void) | undefined;
  searchValue?: string | undefined;
  onSearchChange?: ((value: string) => void) | undefined;
  onSearchSubmit?: ((value: string) => void) | undefined;
  /** Keycaps for the shortcut that focuses search. */
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
  searchShortcut = ['Ctrl', 'K'],
  reservedControlsWidth = DEFAULT_RESERVED_CONTROLS_WIDTH,
  labels,
  className,
}: ShellTitleBarProps): ReactElement {
  const text = mergeLabels(labels);
  const reserve: CSSProperties = { paddingInlineEnd: `${reservedControlsWidth}px` };
  const switcherName = `${text.projectSwitcher} · ${projectName}`;

  return (
    <header
      className={['pc-titlebar', s.bar, className].filter(Boolean).join(' ')}
      style={reserve}
      data-app-region="drag"
    >
      <span className={s.logo} aria-hidden="true">
        <span className={s.pip} data-pip="a" />
        <span className={s.pip} data-pip="b" />
        <span className={s.pip} data-pip="c" />
      </span>

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
    </header>
  );
}
