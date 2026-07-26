import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@partyco/icons';
import styles from './CommandPalette.module.css';

/** Одна строка палитры. Всё, что видно в строке, приходит здесь — компонент ничего не выдумывает. */
export interface CommandPaletteItem {
  id: string;
  /** Основная подпись. Рендерится моношрифтом — это идентификатор команды/модели/файла. */
  label: string;
  /** Пояснение справа от подписи. */
  description?: string;
  /** Мелкие чипы: возможности модели, флаги команды. */
  tags?: readonly string[];
  /** Правый блок №1 — например, окно контекста. */
  meta?: string;
  /** Правый блок №2 — например, цена. Выровнен по правому краю фиксированной колонкой. */
  trailing?: string;
  /** Тон правого блока №2. Статусный цвет здесь работает в роли «текст». */
  trailingTone?: 'default' | 'success' | 'warning' | 'danger';
  icon?: IconName;
  /** Дополнительные слова для фильтра — не показываются. */
  keywords?: readonly string[];
  disabled?: boolean;
}

/** Группа строк с моно-заголовком и квадратным бейджем. */
export interface CommandPaletteGroup {
  id: string;
  label: string;
  /** 1–2 символа в квадрате слева от заголовка. */
  badge?: string;
  /** `dashed` — пунктирный бейдж (в дизайне так помечен локальный провайдер). */
  badgeVariant?: 'solid' | 'dashed';
  items: readonly CommandPaletteItem[];
}

/** Подсказка в подвале: набор клавиш и подпись. */
export interface CommandPaletteHint {
  keys: readonly string[];
  label?: string;
  /** `end` — прижать к правому краю подвала. */
  align?: 'start' | 'end';
}

export interface CommandPaletteProps {
  open: boolean;
  groups: readonly CommandPaletteGroup[];
  onClose: () => void;
  onSelect: (item: CommandPaletteItem, group: CommandPaletteGroup) => void;
  /**
   * Буква, которая вместе с Cmd/Ctrl открывает и закрывает палитру. `null` — выключить хоткей.
   * Слушатель живёт, пока компонент смонтирован, поэтому держите его в дереве и при `open={false}`.
   */
  hotkey?: string | null;
  onRequestOpen?: () => void;
  /** id уже применённого элемента — на него встаёт курсор при открытии. */
  value?: string | null;
  /** id недавних элементов. Показываются отдельной группой, пока запрос пуст. */
  recentIds?: readonly string[];
  /** Управляемый запрос. Если не передан, палитра хранит его сама и чистит при открытии. */
  query?: string;
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  error?: string | null;
  /** `overlay` — модалка в портале с фокус-трапом; `inline` — врезка в поток (для превью). */
  presentation?: 'overlay' | 'inline';
  /**
   * Класс на панель. Нужен специализациям палитры, чтобы переопределить её локальные переменные
   * (`--pc-palette-trailing-w` и т.п.) — не для цвета и не для шрифта.
   */
  className?: string | undefined;
  /** Закрывать после выбора. По умолчанию да. */
  closeOnSelect?: boolean;
  hints?: readonly CommandPaletteHint[];
  /** Доступное имя диалога. */
  label?: string;
  placeholder?: string;
  recentLabel?: string;
  emptyLabel?: string;
  emptyHint?: string;
  loadingLabel?: string;
  errorHint?: string;
  countLabel?: (shown: number, total: number) => string;
}

interface Entry {
  /** Уникальный ключ строки в текущем списке: секция + id. */
  key: string;
  /** id узла в DOM — для `aria-activedescendant` и прокрутки. */
  domId: string;
  item: CommandPaletteItem;
  /** Исходная группа — именно она уходит в `onSelect`, даже если строка показана в «Недавних». */
  group: CommandPaletteGroup;
}

interface Section {
  key: string;
  /** Группа, чей заголовок рисуем (для недавних — синтетическая). */
  header: CommandPaletteGroup;
  entries: Entry[];
}

const DEFAULT_HINTS: readonly CommandPaletteHint[] = [
  { keys: ['↑↓'], label: 'выбор' },
  { keys: ['⏎'], label: 'применить' },
  { keys: ['Esc'], label: 'закрыть', align: 'end' },
];

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Склейка классов CSS-модуля: `noUncheckedIndexedAccess` делает каждый из них `string | undefined`. */
function cx(...parts: readonly (string | undefined | false)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ');
}

function haystack(item: CommandPaletteItem, group: CommandPaletteGroup): string {
  return [item.label, item.description ?? '', ...(item.keywords ?? []), ...(item.tags ?? []), group.label]
    .join(' ')
    .toLowerCase();
}

function matches(item: CommandPaletteItem, group: CommandPaletteGroup, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const hay = haystack(item, group);
  return terms.every((t) => hay.includes(t));
}

function firstEnabled(entries: readonly Entry[]): number {
  return entries.findIndex((e) => !e.item.disabled);
}

function seekEnabled(entries: readonly Entry[], from: number, dir: 1 | -1): number {
  const n = entries.length;
  if (n === 0) return -1;
  for (let step = 0; step < n; step += 1) {
    const i = (((from + dir * step) % n) + n) % n;
    if (!entries[i]!.item.disabled) return i;
  }
  return -1;
}

function trailingClass(tone: CommandPaletteItem['trailingTone']): string | undefined {
  switch (tone) {
    case 'success':
      return styles.trailingSuccess;
    case 'warning':
      return styles.trailingWarning;
    case 'danger':
      return styles.trailingDanger;
    default:
      return undefined;
  }
}

/**
 * Универсальная палитра команд: ⌘K/Ctrl+K, группы, недавние, фильтр по подстроке и полное
 * управление с клавиатуры (стрелки, Home/End, Enter, Esc). Фильтр — обычный `useMemo`, без
 * дебаунса: список у нас маленький, а задержка ощущается сразу.
 */
export function CommandPalette({
  open,
  groups,
  onClose,
  onSelect,
  hotkey = 'k',
  onRequestOpen,
  value = null,
  recentIds,
  query: queryProp,
  onQueryChange,
  loading = false,
  error = null,
  presentation = 'overlay',
  className,
  closeOnSelect = true,
  hints = DEFAULT_HINTS,
  label = 'Палитра команд',
  placeholder = 'Команда, файл или модель…',
  recentLabel = 'Недавние',
  emptyLabel = 'Ничего не найдено',
  emptyHint = 'Фильтр ищет по имени, группе и описанию — попробуйте короче',
  loadingLabel = 'Собираем список…',
  errorHint = 'Повторите позже — список подтянется сам',
  countLabel = (shown, total) => `${shown} из ${total}`,
}: CommandPaletteProps): ReactElement | null {
  const reactId = useId();
  const listId = `${reactId}-list`;
  const inputId = `${reactId}-input`;

  const [innerQuery, setInnerQuery] = useState('');
  const query = queryProp ?? innerQuery;
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const terms = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];

    if (terms.length === 0 && recentIds && recentIds.length > 0) {
      const byId = new Map<string, Entry>();
      for (const group of groups) {
        for (const item of group.items) {
          if (!byId.has(item.id)) {
            byId.set(item.id, {
              key: `recent::${item.id}`,
              domId: `${reactId}-recent-${item.id}`,
              item,
              group,
            });
          }
        }
      }
      const entries = recentIds
        .map((id) => byId.get(id))
        .filter((e): e is Entry => e !== undefined);
      if (entries.length > 0) {
        out.push({
          key: 'recent',
          header: { id: 'recent', label: recentLabel, items: [] },
          entries,
        });
      }
    }

    for (const group of groups) {
      const entries = group.items
        .filter((item) => matches(item, group, terms))
        .map((item) => ({
          key: `${group.id}::${item.id}`,
          domId: `${reactId}-${group.id}-${item.id}`,
          item,
          group,
        }));
      if (entries.length > 0) out.push({ key: group.id, header: group, entries });
    }

    return out;
  }, [groups, reactId, recentIds, recentLabel, terms]);

  const entries = useMemo(() => sections.flatMap((s) => s.entries), [sections]);

  /**
   * Курсор живёт как ключ строки, а индекс выводится каждый раз заново: после фильтрации выбор
   * либо сохраняется, либо честно падает на первую доступную строку. Пока пользователь не двигал
   * курсор (`activeKey === null`), он стоит на уже применённом элементе — если тот в списке.
   */
  const activeIndex = useMemo(() => {
    const byKey = entries.findIndex((e) => e.key === activeKey);
    if (byKey >= 0 && !entries[byKey]!.item.disabled) return byKey;
    if (activeKey === null && value) {
      const byValue = entries.findIndex((e) => e.item.id === value && !e.item.disabled);
      if (byValue >= 0) return byValue;
    }
    return firstEnabled(entries);
  }, [entries, activeKey, value]);

  const activeEntry = activeIndex >= 0 ? entries[activeIndex] : undefined;

  const total = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);
  const shown = useMemo(
    () => sections.filter((s) => s.key !== 'recent').reduce((n, s) => n + s.entries.length, 0),
    [sections],
  );

  const setQuery = useCallback(
    (next: string) => {
      if (queryProp === undefined) setInnerQuery(next);
      onQueryChange?.(next);
    },
    [onQueryChange, queryProp],
  );

  const commit = useCallback(
    (entry: Entry | undefined) => {
      if (!entry || entry.item.disabled) return;
      onSelect(entry.item, entry.group);
      if (closeOnSelect) onClose();
    },
    [closeOnSelect, onClose, onSelect],
  );

  const move = useCallback(
    (dir: 1 | -1) => {
      if (entries.length === 0) return;
      const from = activeIndex < 0 ? (dir === 1 ? 0 : entries.length - 1) : activeIndex + dir;
      const next = seekEnabled(entries, from, dir);
      if (next >= 0) setActiveKey(entries[next]!.key);
    },
    [activeIndex, entries],
  );

  const jump = useCallback(
    (to: 'first' | 'last') => {
      if (entries.length === 0) return;
      const next =
        to === 'first' ? seekEnabled(entries, 0, 1) : seekEnabled(entries, entries.length - 1, -1);
      if (next >= 0) setActiveKey(entries[next]!.key);
    },
    [entries],
  );

  // ⌘K / Ctrl+K — открыть и закрыть. Живёт, пока компонент смонтирован.
  useEffect(() => {
    if (!hotkey) return;
    const want = hotkey.toLowerCase();
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== want) return;
      event.preventDefault();
      if (open) onClose();
      else onRequestOpen?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey, onClose, onRequestOpen, open]);

  // Открылись — чистим запрос и отпускаем курсор на применённый элемент (см. activeIndex).
  // Зависимость строго от `open`: новый по ссылке массив groups от родителя не должен
  // сбрасывать запрос на каждом нажатии клавиши.
  useEffect(() => {
    if (!open) return;
    setInnerQuery('');
    setActiveKey(null);
  }, [open]);

  // Фокус в поле сразу при монтировании — и возврат туда, откуда пришли.
  const autoFocus = presentation === 'overlay';
  useEffect(() => {
    if (!open || !autoFocus) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      const previous = restoreRef.current;
      restoreRef.current = null;
      if (previous && previous.isConnected) previous.focus();
    };
  }, [autoFocus, open]);

  // Активная строка всегда в поле зрения.
  const activeDomId = activeEntry?.domId;
  useEffect(() => {
    if (!open || !activeDomId) return;
    document.getElementById(activeDomId)?.scrollIntoView({ block: 'nearest' });
  }, [activeDomId, open]);

  const trapTab = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const root = panelRef.current;
    if (!root) return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        case 'Tab':
          if (presentation === 'overlay') trapTab(event);
          return;
        case 'ArrowDown':
          event.preventDefault();
          move(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          move(-1);
          return;
        // Пока в поле есть текст, Home/End принадлежат каретке — забираем их только у пустого поля.
        case 'Home':
          if (query.length > 0) return;
          event.preventDefault();
          jump('first');
          return;
        case 'End':
          if (query.length > 0) return;
          event.preventDefault();
          jump('last');
          return;
        case 'Enter':
          event.preventDefault();
          commit(activeIndex >= 0 ? entries[activeIndex] : undefined);
          return;
        default:
      }
    },
    [activeIndex, commit, entries, jump, move, onClose, presentation, query, trapTab],
  );

  const onScrimMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const body = ((): ReactElement => {
    if (loading) {
      return (
        <div className={styles.results} aria-busy="true">
          <div className={styles.loadingHead} role="status">
            <span className={styles.stateHint}>{loadingLabel}</span>
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div className={styles.skeletonRow} key={i} aria-hidden="true">
              <span className={cx(styles.skeletonBar, styles.skeletonWide)} />
              <span className={cx(styles.skeletonBar, styles.skeletonNarrow)} />
            </div>
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className={styles.results}>
          <div className={cx(styles.state, styles.stateError)} role="status">
            <Icon name="incident" />
            <span className={styles.stateTitle}>{error}</span>
            <span className={styles.stateHint}>{errorHint}</span>
          </div>
        </div>
      );
    }

    if (entries.length === 0) {
      return (
        <div className={styles.results}>
          <div className={styles.state} role="status">
            <Icon name="search" />
            <span className={styles.stateTitle}>{emptyLabel}</span>
            <span className={styles.stateHint}>{emptyHint}</span>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.results}>
        <div id={listId} role="listbox" aria-label={label}>
          {sections.map((section) => {
            const headId = `${reactId}-${section.key}-head`;
            return (
              <div className={styles.group} key={section.key} role="group" aria-labelledby={headId}>
                <div className={styles.groupHead} id={headId}>
                  {section.header.badge ? (
                    <span
                      className={cx(
                        styles.badge,
                        section.header.badgeVariant === 'dashed' && styles.badgeDashed,
                      )}
                      aria-hidden="true"
                    >
                      {section.header.badge}
                    </span>
                  ) : null}
                  <span className={styles.groupLabel}>{section.header.label}</span>
                </div>
                {section.entries.map((entry) => {
                  const { item } = entry;
                  const isActive = entry.key === activeEntry?.key;
                  return (
                    <div
                      key={entry.key}
                      id={entry.domId}
                      className={cx(
                        styles.row,
                        isActive && styles.rowActive,
                        item.disabled && styles.rowDisabled,
                      )}
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={item.disabled ? true : undefined}
                      onMouseMove={() => {
                        if (!item.disabled) setActiveKey(entry.key);
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commit(entry)}
                    >
                      {item.icon ? <Icon name={item.icon} className={styles.rowIcon} /> : null}
                      <span className={styles.name}>{item.label}</span>
                      {item.tags && item.tags.length > 0 ? (
                        <span className={styles.tags}>
                          {item.tags.map((tag) => (
                            <span className={styles.tag} key={tag}>
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {item.description ? (
                        <span className={styles.description}>{item.description}</span>
                      ) : null}
                      {item.meta || item.trailing ? (
                        <span className={styles.rowEnd}>
                          {item.meta ? <span className={styles.meta}>{item.meta}</span> : null}
                          {item.trailing ? (
                            <span className={cx(styles.trailing, trailingClass(item.trailingTone))}>
                              {item.trailing}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  })();

  const panel = (
    <div
      className={cx(styles.panel, presentation === 'inline' && styles.panelInline, className)}
      ref={panelRef}
      role="dialog"
      aria-modal={presentation === 'overlay' ? true : undefined}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <div className={styles.header}>
        <Icon name="search" />
        <input
          className={styles.input}
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          aria-activedescendant={activeEntry ? activeEntry.domId : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {total > 0 ? <span className={styles.count}>{countLabel(shown, total)}</span> : null}
      </div>

      {body}

      {hints.length > 0 ? (
        <div className={styles.footer}>
          {hints.map((hint) => (
            <span
              className={cx(styles.hint, hint.align === 'end' && styles.hintEnd)}
              key={hint.keys.join('+') + (hint.label ?? '')}
            >
              <span className={styles.keys}>
                {hint.keys.map((key) => (
                  <kbd className={styles.kbd} key={key}>
                    {key}
                  </kbd>
                ))}
              </span>
              {hint.label ? <span className={styles.hintLabel}>{hint.label}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );

  if (presentation === 'inline') return panel;

  return createPortal(
    <div className={styles.scrim} onMouseDown={onScrimMouseDown}>
      {panel}
    </div>,
    document.body,
  );
}
