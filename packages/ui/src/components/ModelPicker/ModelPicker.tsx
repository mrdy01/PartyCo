import { useCallback, useMemo, type ReactElement } from 'react';
import {
  CommandPalette,
  type CommandPaletteGroup,
  type CommandPaletteHint,
  type CommandPaletteItem,
} from '../CommandPalette/CommandPalette.tsx';
import styles from './ModelPicker.module.css';

/** Возможности модели. Показываются чипами в том же виде, что в дизайне — это технические флаги. */
export type ModelCapability = 'tools' | 'stream' | 'cache' | 'vision' | 'reason' | 'audio';

export interface ModelOption {
  /** Полный идентификатор модели: `claude-sonnet-4-6`. Он же и подпись строки. */
  id: string;
  /** Окно контекста в токенах. Рендерится как `200k`. */
  contextWindow?: number;
  /** Готовая подпись окна контекста, если считать не надо. */
  contextLabel?: string;
  capabilities?: readonly ModelCapability[];
  /** Цена за миллион токенов или её замена: `$15/M`, `в подписке`, `бесплатно`. */
  costLabel: string;
  /** Модель уже покрыта подпиской или локальная — цена печатается успешным цветом. */
  costIncluded?: boolean;
  /** Провайдер отвалился или ключа нет — строка видна, но не выбирается. */
  disabled?: boolean;
  /** Дополнительные слова для поиска: алиасы, «опус», «дешёвая». */
  keywords?: readonly string[];
}

export interface ModelProviderGroup {
  id: string;
  /** Заголовок группы: `Anthropic · подписка Max`. */
  label: string;
  /** Квадратный бейдж. По умолчанию — первая буква заголовка. */
  badge?: string;
  /** Локальный провайдер: бейдж рисуется пунктиром. */
  local?: boolean;
  models: readonly ModelOption[];
}

export interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
  providers: readonly ModelProviderGroup[];
  /** Модель, применённая к сессии сейчас — курсор встаёт на неё при открытии. */
  value?: string | null;
  onSelect: (modelId: string, providerId: string) => void;
  /** Хоткей вместе с Cmd/Ctrl. По умолчанию `m` (в дизайне подсказка Ctrl ⇧ M). */
  hotkey?: string | null;
  onRequestOpen?: () => void;
  /** id недавно применённых моделей — отдельной группой, пока запрос пуст. */
  recentIds?: readonly string[];
  loading?: boolean;
  error?: string | null;
  presentation?: 'overlay' | 'inline';
  hints?: readonly CommandPaletteHint[];
  label?: string;
  placeholder?: string;
  recentLabel?: string;
  emptyLabel?: string;
  emptyHint?: string;
  countLabel?: (shown: number, total: number) => string;
}

const MODEL_HINTS: readonly CommandPaletteHint[] = [
  { keys: ['↑↓'], label: 'выбор' },
  { keys: ['⏎'], label: 'применить к сессии' },
  { keys: ['Ctrl', '⇧', 'M'], align: 'end' },
];

/** `200000 → 200k`, `1500000 → 1.5M`. Дизайн печатает окно контекста коротко. */
export function formatContextWindow(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '—';
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * Выбор модели для сессии: та же палитра, но строки знают про окно контекста, возможности и цену.
 * Группировка — по провайдеру, локальный помечен пунктирным бейджем.
 */
export function ModelPicker({
  open,
  onClose,
  providers,
  value = null,
  onSelect,
  hotkey = 'm',
  onRequestOpen,
  recentIds,
  loading = false,
  error = null,
  presentation = 'overlay',
  hints = MODEL_HINTS,
  label = 'Выбор модели для сессии',
  placeholder = 'Модель или провайдер…',
  recentLabel = 'Недавние',
  emptyLabel = 'Такой модели нет',
  emptyHint = 'Проверьте запрос или добавьте провайдера в настройках',
  countLabel,
}: ModelPickerProps): ReactElement | null {
  const groups = useMemo<CommandPaletteGroup[]>(
    () =>
      providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        badge: provider.badge ?? provider.label.slice(0, 1),
        badgeVariant: provider.local ? ('dashed' as const) : ('solid' as const),
        items: provider.models.map((model) => {
          const contextLabel =
            model.contextLabel ??
            (model.contextWindow === undefined ? undefined : formatContextWindow(model.contextWindow));
          const item: CommandPaletteItem = {
            id: model.id,
            label: model.id,
            trailing: model.costLabel,
            trailingTone: model.costIncluded ? 'success' : 'default',
          };
          if (model.capabilities && model.capabilities.length > 0) item.tags = model.capabilities;
          if (contextLabel !== undefined) item.meta = contextLabel;
          if (model.keywords !== undefined) item.keywords = model.keywords;
          if (model.disabled !== undefined) item.disabled = model.disabled;
          return item;
        }),
      })),
    [providers],
  );

  const handleSelect = useCallback(
    (item: CommandPaletteItem, group: CommandPaletteGroup) => {
      onSelect(item.id, group.id);
    },
    [onSelect],
  );

  return (
    <CommandPalette
      open={open}
      className={styles.picker}
      groups={groups}
      onClose={onClose}
      onSelect={handleSelect}
      hotkey={hotkey}
      {...(onRequestOpen ? { onRequestOpen } : {})}
      value={value}
      {...(recentIds ? { recentIds } : {})}
      loading={loading}
      error={error}
      presentation={presentation}
      hints={hints}
      label={label}
      placeholder={placeholder}
      recentLabel={recentLabel}
      emptyLabel={emptyLabel}
      emptyHint={emptyHint}
      {...(countLabel ? { countLabel } : {})}
    />
  );
}
