import type { ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import { Rich, type RichText, type TextSegment } from '../Toast/rich.tsx';
import s from './CredentialGuarantee.module.css';

export interface CredentialGuaranteeProps {
  /** Where the secrets actually live, e.g. `Windows Credential Manager`. */
  storeName: string;
  /** How many secrets the OS keychain currently holds. */
  keysStored: number;
  /**
   * How many secrets ever left for the hub. The whole point of the element is that this is `0`;
   * anything above zero renders in the danger colour so it cannot be read as normal.
   */
  sentToHub?: number | undefined;
  title?: string | undefined;
  description?: RichText | undefined;
  keysLabel?: string | undefined;
  hubLabel?: string | undefined;
  actionLabel?: string | undefined;
  /** Opens the OS keychain. Omit and the button disappears — never render a dead control. */
  onOpenStore?: (() => void) | undefined;
  verifyNote?: string | undefined;
  className?: string | undefined;
}

const DEFAULT_TITLE = 'Ключи не покидают эту машину';

const DEFAULT_VERIFY_NOTE =
  'Проверяемо: включи «журнал исходящих» — увидишь адресатов каждого запроса.';

const DEFAULT_ACTION_LABEL = 'Открыть хранилище';

function defaultDescription(storeName: string): TextSegment[] {
  return [
    'Токены и API-ключи лежат в ',
    { text: storeName, emphasis: 'code' },
    '. Хаб, VPS-релей и участники команды видят только имя модели и счётчик токенов — сам ключ им ' +
      'недоступен, запросы к провайдеру уходят прямо с твоего компьютера.',
  ];
}

/** `1 ключ` / `2 ключа` / `5 ключей`. */
function pluralKeys(count: number): string {
  const withinTeens = Math.abs(count) % 100;
  const lastDigit = Math.abs(count) % 10;
  if (withinTeens >= 11 && withinTeens <= 14) return 'ключей';
  if (lastDigit === 1) return 'ключ';
  if (lastDigit >= 2 && lastDigit <= 4) return 'ключа';
  return 'ключей';
}

/**
 * The keychain guarantee. Spec treats this as a real UI element rather than fine print: it states
 * where the secrets live, proves it with two counters, and offers a way to check.
 */
export function CredentialGuarantee({
  storeName,
  keysStored,
  sentToHub = 0,
  title = DEFAULT_TITLE,
  description,
  keysLabel,
  hubLabel,
  actionLabel = DEFAULT_ACTION_LABEL,
  onOpenStore,
  verifyNote = DEFAULT_VERIFY_NOTE,
  className,
}: CredentialGuaranteeProps): ReactElement {
  const leaked = sentToHub > 0;
  return (
    <section className={[s.root, className].filter(Boolean).join(' ')} aria-label={title}>
      <div className={s.body}>
        <Icon name="keychain" className={s.shield} />
        <div className={s.text}>
          <span className={s.title}>{title}</span>
          <p className={s.description}>
            <Rich value={description ?? defaultDescription(storeName)} />
          </p>
          <div className={s.pills}>
            <span className={s.pill}>
              <span className={s.dot} data-status="success" />
              {keysLabel ?? `${keysStored} ${pluralKeys(keysStored)} в хранилище`}
            </span>
            <span className={s.pill} data-status={leaked ? 'danger' : undefined}>
              {hubLabel ?? `${sentToHub} отправлено на хаб`}
            </span>
            {onOpenStore ? (
              <button type="button" className={s.action} onClick={onOpenStore}>
                {actionLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className={s.footer}>
        <span className={s.note}>{verifyNote}</span>
      </div>
    </section>
  );
}
