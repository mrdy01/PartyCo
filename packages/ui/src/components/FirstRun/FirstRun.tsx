import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import {
  FIRST_RUN_PROVIDERS,
  KEY_GUARANTEE_STORAGE,
  type FirstRunProvider,
} from '../AppShell/model.ts';
import { Button } from '../Button/Button.tsx';
import { Input } from '../Input/Input.tsx';
import { ProviderGlyph } from '../ProviderGlyph/ProviderGlyph.tsx';
import s from './FirstRun.module.css';

/* ------------------------------------------------------------------ model */

/** Both steps are skippable, and there are only ever two of them. */
export type FirstRunStep = 1 | 2;

export const FIRST_RUN_STEP_COUNT = 2;

/** What the key step hands back. The key is passed once, to the caller, and nowhere else. */
export interface FirstRunKeySubmit {
  providerId: string;
  key: string;
}

/* ------------------------------------------------------------------- copy */

export interface FirstRunFolderCopy {
  /** `{name}` is replaced with the person's name. */
  title: string;
  /** Used verbatim when there is no name to put in front. */
  titleAnonymous: string;
  body: string;
  primary: string;
  secondary: string;
  footnote: string;
}

export interface FirstRunKeyCopy {
  title: string;
  body: string;
  /** Accessible name of the provider row. */
  providerGroup: string;
  /** Label of the key field. */
  field: string;
  primary: string;
  /** Button label while the key is being stored. */
  busy: string;
  skip: string;
  /** Where the key actually goes. Stated next to the field that asks for it. */
  guarantee: string;
}

export interface FirstRunCopy {
  /** Accessible name of the whole panel. */
  region: string;
  /** «Первый запуск» — the standing heading of both steps. */
  heading: string;
  /** `{step}` and `{total}` are replaced with the numbers. */
  progress: string;
  /** Accessible name of the live region that carries the failure. */
  statusRegion: string;
  folder: FirstRunFolderCopy;
  key: FirstRunKeyCopy;
}

/**
 * Overrides. Nested one level deep on purpose: a flat `Partial<FirstRunCopy>` would let a caller
 * that wanted to change one word of the folder step replace the whole block with it, which is
 * exactly how a copy block was wiped once already.
 */
export interface FirstRunCopyInput extends Partial<Omit<FirstRunCopy, 'folder' | 'key'>> {
  folder?: Partial<FirstRunFolderCopy>;
  key?: Partial<FirstRunKeyCopy>;
}

export const FIRST_RUN_COPY: FirstRunCopy = {
  region: 'Первый запуск',
  heading: 'Первый запуск',
  progress: 'Шаг {step} из {total}',
  statusRegion: 'Ответ приложения',
  folder: {
    title: '{name}, покажи, где лежит код',
    titleAnonymous: 'Покажи, где лежит код',
    body:
      'PartyCo смотрит на одну папку с проектом. Выбери её — дальше всё настроится по ходу ' +
      'работы, отдельного мастера не будет.',
    primary: 'Выбрать папку…',
    secondary: 'Меня позвали в проект команды',
    footnote:
      'Второй шаг — ключ провайдера. Его можно пропустить: без ключа приложение работает, ' +
      'просто агент не отвечает.',
  },
  key: {
    title: 'Агент работает на твоём ключе',
    body:
      'Вставь ключ любого из провайдеров. Он останется на этой машине — хаб команды его не ' +
      'получит и не сможет получить.',
    providerGroup: 'Провайдер',
    field: 'Ключ',
    primary: 'Сохранить и начать',
    busy: 'Сохраняем…',
    skip: 'Пропустить — добавлю позже',
    guarantee: KEY_GUARANTEE_STORAGE,
  },
};

function mergeCopy(input: FirstRunCopyInput | undefined): FirstRunCopy {
  if (!input) return FIRST_RUN_COPY;
  return {
    ...FIRST_RUN_COPY,
    ...input,
    folder: { ...FIRST_RUN_COPY.folder, ...input.folder },
    key: { ...FIRST_RUN_COPY.key, ...input.key },
  };
}

/* ------------------------------------------------------------------ props */

export interface FirstRunProps {
  /** Which of the two steps is on screen. The host owns the sequence — this panel owns one card. */
  step: FirstRunStep;
  /**
   * The person's name, for the first line of step 1. Blank is a supported answer: the title falls
   * back to the nameless form rather than greeting a comma.
   */
  userName?: string | undefined;

  /** Step 1: opens the OS folder picker. The panel never touches the filesystem itself. */
  onChooseFolder: () => void;
  /** Step 1: «Меня позвали в проект команды» — hands over to the join-by-code flow. */
  onJoinTeam: () => void;

  /** Step 2: the providers to offer. Defaults to the three the model knows. */
  providers?: readonly FirstRunProvider[] | undefined;
  /** Selected provider. Omit and the panel keeps the choice itself. */
  providerId?: string | undefined;
  onProviderChange?: ((providerId: string) => void) | undefined;
  /**
   * The key, if the caller wants to own it. Omit and the panel holds the draft — either way the
   * value leaves only through `onKeyChange` and `onSaveKey`.
   */
  keyValue?: string | undefined;
  onKeyChange?: ((key: string) => void) | undefined;
  /** Step 2: store the key. Whatever "store" means is the caller's business, not this panel's. */
  onSaveKey: (input: FirstRunKeySubmit) => void;
  /** Step 2: «Пропустить — добавлю позже». Both steps are skippable, and this is how. */
  onSkip: () => void;

  /** Идёт запрос: кнопка занята, форма помечена `aria-busy`. */
  busy?: boolean | undefined;
  /**
   * Человеческий текст ошибки. Owned by the caller, exactly as in `AuthPanel`: the panel cannot
   * know whether a message still applies, so it never clears one by itself.
   */
  error?: string | null | undefined;
  copy?: FirstRunCopyInput | undefined;
  className?: string | undefined;
}

/* -------------------------------------------------------------- component */

/**
 * First run: two cards, both skippable — the project folder, then a provider key.
 *
 * Screens 02 of the shell export, lines 477–523. The shape of the thing is the argument: two steps,
 * not ten, and neither one blocks. Theme, density, inviting the team and marking out zones all
 * arrive later, out of the work, because a wizard in front of a product nobody has seen yet teaches
 * nothing — which is the same reason the designer took the theme and density pickers off the door.
 *
 * The key field is a password by nature and is treated as one: `type="password"`, autocomplete off,
 * spellcheck off, and the value leaves through `onKeyChange`/`onSaveKey` and nowhere else. This
 * component does not know what a keychain is, does not touch `localStorage` and logs nothing — the
 * sentence under the field («ключ ляжет в хранилище Windows…») is a promise the *caller* keeps, and
 * the only way to keep it is for the value never to be written down here.
 */
export function FirstRun({
  step,
  userName,
  onChooseFolder,
  onJoinTeam,
  providers = FIRST_RUN_PROVIDERS,
  providerId,
  onProviderChange,
  keyValue,
  onKeyChange,
  onSaveKey,
  onSkip,
  busy = false,
  error,
  copy,
  className,
}: FirstRunProps): ReactElement {
  const t = mergeCopy(copy);

  const autoId = useId();
  const statusId = `pc-first-run-${autoId}-status`;

  const [providerPick, setProviderPick] = useState<string | null>(null);
  const activeId = providerId ?? providerPick ?? providers[0]?.id ?? '';
  const active = providers.find((item) => item.id === activeId);

  const [keyDraft, setKeyDraft] = useState('');
  const key = keyValue ?? keyDraft;

  function selectProvider(next: string): void {
    if (next === activeId) return;
    if (providerId === undefined) setProviderPick(next);
    onProviderChange?.(next);
  }

  function changeKey(next: string): void {
    if (keyValue === undefined) setKeyDraft(next);
    onKeyChange?.(next);
  }

  function handleSave(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // Never trimmed on the way in; trimmed once here, because a pasted key carries a stray newline
    // far more often than it carries a meaningful edge space.
    const value = key.trim();
    if (busy || value === '' || activeId === '') return;
    onSaveKey({ providerId: activeId, key: value });
  }

  const message = error !== null && error !== undefined && error !== '' ? error : null;

  const progress = t.progress
    .replace('{step}', String(step))
    .replace('{total}', String(FIRST_RUN_STEP_COUNT));

  const name = userName?.trim() ?? '';
  const folderTitle = name === '' ? t.folder.titleAnonymous : t.folder.title.replace('{name}', name);

  /* The one live region, shared by both steps — the failure of either is the same kind of news. */
  const status = (
    <div
      className={s.status}
      id={statusId}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={t.statusRegion}
    >
      {message ? (
        <>
          <Icon name="incident" className={s.statusGlyph} />
          <span className={s.statusText}>{message}</span>
        </>
      ) : null}
    </div>
  );

  return (
    <div className={[s.screen, className ?? ''].filter(Boolean).join(' ')}>
      <section className={s.panel} aria-label={t.region}>
        <header className={s.head}>
          <span className={s.heading}>{t.heading}</span>
          {/* The step is stated in words; the two bars repeat it for the eye and nothing more. */}
          <span className={s.progress}>{progress}</span>
          <span className={s.bars} aria-hidden="true">
            <span className={s.bar} data-done="true" />
            <span className={s.bar} data-done={step === 2 ? 'true' : undefined} />
          </span>
        </header>

        {step === 1 ? (
          <>
            <div className={s.intro}>
              <h2 className={s.title}>{folderTitle}</h2>
              <p className={s.body}>{t.folder.body}</p>
            </div>

            <div className={s.actions}>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className={s.cta}
                icon="folder"
                onClick={onChooseFolder}
              >
                {t.folder.primary}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                className={s.cta}
                onClick={onJoinTeam}
              >
                {t.folder.secondary}
              </Button>
            </div>

            {status}

            <p className={s.footnote}>{t.folder.footnote}</p>
          </>
        ) : (
          <>
            <div className={s.intro}>
              <h2 className={s.title}>{t.key.title}</h2>
              <p className={s.body}>{t.key.body}</p>
            </div>

            <form
              className={s.form}
              noValidate
              aria-label={t.key.title}
              aria-busy={busy || undefined}
              aria-describedby={message ? statusId : undefined}
              onSubmit={handleSave}
            >
              <div className={s.picker}>
                {/*
                 * No providers is a real answer, not a crash: the row disappears rather than
                 * leaving a labelled group with nothing in it, and the submit stays disabled
                 * because there is no provider to attach a key to.
                 */}
                {providers.length > 0 ? (
                  <div className={s.providers} role="group" aria-label={t.key.providerGroup}>
                    {providers.map((item) => (
                      <ProviderGlyph
                        key={item.id}
                        providerId={item.id}
                        label={item.label}
                        letter={item.glyph}
                        selected={item.id === activeId}
                        onClick={() => selectProvider(item.id)}
                        className={s.provider}
                      />
                    ))}
                  </div>
                ) : null}

                <Input
                  className={s.keyField}
                  label={t.key.field}
                  type="password"
                  name="provider-key"
                  mono
                  /* A provider key is not a login: no manager should offer to fill or keep it. */
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={active?.keyHint}
                  value={key}
                  onChange={(event) => changeKey(event.target.value)}
                />
              </div>

              <div className={s.actions}>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  className={s.cta}
                  loading={busy}
                  loadingLabel={t.key.busy}
                  disabled={key.trim() === '' || activeId === ''}
                >
                  {t.key.primary}
                </Button>
                {/* Skipping is a first-class answer here, so it is a real button, centred. */}
                <Button variant="ghost" size="md" className={s.skip} onClick={onSkip}>
                  {t.key.skip}
                </Button>
              </div>

              {status}
            </form>

            <footer className={s.guarantee}>
              <Icon name="keychain" className={s.guaranteeGlyph} />
              <p className={s.guaranteeText}>{t.key.guarantee}</p>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
