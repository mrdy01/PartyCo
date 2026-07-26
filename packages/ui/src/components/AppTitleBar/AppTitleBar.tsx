import {
  useCallback,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { DensityName, ThemeName } from '@partyco/tokens';
import { Icon } from '@partyco/icons';
import { SearchField } from '../SearchField/SearchField.tsx';
import s from './AppTitleBar.module.css';

export interface AppTitleBarLabels {
  /** Accessible name of the project switcher chip. */
  projectSwitcher: string;
  /** Accessible name of the breadcrumb navigation. */
  breadcrumb: string;
  /** Accessible name of the search field. */
  search: string;
  searchPlaceholder: string;
  themeGroup: string;
  themeDark: string;
  themeLight: string;
  densityGroup: string;
  densityComfortable: string;
  densityCompact: string;
}

export type AppTitleBarLabelsInput = Partial<AppTitleBarLabels>;

export const APP_TITLE_BAR_LABELS: AppTitleBarLabels = {
  projectSwitcher: 'Сменить проект',
  breadcrumb: 'Путь',
  search: 'Поиск по проекту',
  searchPlaceholder: 'Найти файл, задачу, участника…',
  themeGroup: 'Тема',
  themeDark: 'Тёмная',
  themeLight: 'Светлая',
  densityGroup: 'Плотность',
  densityComfortable: 'Comfort',
  densityCompact: 'Compact',
};

export interface AppTitleBarProps {
  /** Project display name, e.g. «Хайтейл». */
  projectName: string;
  /** Secondary line inside the switcher chip, e.g. «РП-сервер». */
  projectHint?: string | undefined;
  onProjectSwitch?: (() => void) | undefined;
  /** Path from the workspace root to what is open, e.g. `['Workspace', 'wallet.ts']`. */
  breadcrumb?: readonly string[] | undefined;
  searchValue?: string | undefined;
  onSearchChange?: ((value: string) => void) | undefined;
  onSearchSubmit?: ((value: string) => void) | undefined;
  /** Keycaps for the shortcut that focuses search. */
  searchShortcut?: readonly string[] | undefined;
  theme: ThemeName;
  onThemeChange?: ((theme: ThemeName) => void) | undefined;
  density: DensityName;
  onDensityChange?: ((density: DensityName) => void) | undefined;
  /**
   * Space kept clear at the trailing edge for the window controls the OS paints on top of this bar.
   * On Windows the app runs with Electron's `titleBarOverlay`, so the buttons are native — this bar
   * deliberately draws none of its own. 140px matches the default overlay width.
   */
  reservedControlsWidth?: number | undefined;
  labels?: AppTitleBarLabelsInput | undefined;
  className?: string | undefined;
}

const DEFAULT_RESERVED_CONTROLS_WIDTH = 140;

/**
 * The 32px application title bar: identity mark, project switcher, breadcrumb, centred search and
 * the two chrome toggles (theme, density).
 *
 * Drag region: the consuming app sets `-webkit-app-region: drag` on this element. Every interactive
 * child is marked `data-no-drag`, and this module turns that attribute into `no-drag`, so clicks
 * keep working while the empty stretches still move the window.
 */
export function AppTitleBar({
  projectName,
  projectHint,
  onProjectSwitch,
  breadcrumb,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  searchShortcut = ['Ctrl', 'K'],
  theme,
  onThemeChange,
  density,
  onDensityChange,
  reservedControlsWidth = DEFAULT_RESERVED_CONTROLS_WIDTH,
  labels,
  className,
}: AppTitleBarProps): ReactElement {
  const text: AppTitleBarLabels = labels ? { ...APP_TITLE_BAR_LABELS, ...labels } : APP_TITLE_BAR_LABELS;
  const crumbs = breadcrumb ?? [];
  const reserve: CSSProperties = { paddingInlineEnd: `${reservedControlsWidth}px` };

  return (
    <header
      className={className ? `${s.bar} ${className}` : s.bar}
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
        aria-label={`${text.projectSwitcher} · ${projectName}`}
        title={`${text.projectSwitcher} · ${projectName}`}
      >
        <span className={s.projectName}>{projectName}</span>
        {projectHint ? <span className={s.projectHint}>{projectHint}</span> : null}
        <Icon name="caret-down" className={s.caret} />
      </button>

      {crumbs.length > 0 ? (
        <nav className={s.breadcrumb} aria-label={text.breadcrumb}>
          <ol className={s.crumbs}>
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <li key={`${index}-${crumb}`} className={s.crumb}>
                  {index > 0 ? <Icon name="chevron-right" className={s.crumbSep} /> : null}
                  <span className={s.crumbText} {...(last ? { 'aria-current': 'page' as const } : {})}>
                    {crumb}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

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

      <div className={s.toggles}>
        <SegmentedToggle<ThemeName>
          label={text.themeGroup}
          value={theme}
          onChange={onThemeChange}
          options={[
            { value: 'dark', label: text.themeDark },
            { value: 'light', label: text.themeLight },
          ]}
        />
        <SegmentedToggle<DensityName>
          label={text.densityGroup}
          value={density}
          onChange={onDensityChange}
          options={[
            { value: 'comfortable', label: text.densityComfortable },
            { value: 'compact', label: text.densityCompact },
          ]}
        />
      </div>
    </header>
  );
}

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedToggleProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange?: ((next: T) => void) | undefined;
}

/**
 * Two-or-more state chrome toggle. A real radio group: arrows move the selection, only the checked
 * option is in the tab order. Local to the title bar — the app has no other segmented control that
 * is not already covered by `AgentModeSelector`.
 */
function SegmentedToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedToggleProps<T>): ReactElement {
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());

  const select = useCallback(
    (next: T) => {
      onChange?.(next);
      buttons.current.get(next)?.focus();
    },
    [onChange],
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (options.length === 0) return;
    const at = options.findIndex((option) => option.value === value);
    if (at < 0) return;
    let target: SegmentOption<T> | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = options[(at + 1) % options.length];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = options[(at - 1 + options.length) % options.length];
        break;
      case 'Home':
        target = options[0];
        break;
      case 'End':
        target = options[options.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target) select(target.value);
  }

  return (
    <div className={s.segmented} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current.set(option.value, node);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={s.segment}
            data-active={active || undefined}
            data-no-drag="true"
            onClick={() => select(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
