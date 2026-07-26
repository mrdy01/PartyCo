import {
  useCallback,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { Icon } from '@partyco/icons';
import { Button } from '../Button/Button.tsx';
import { Input } from '../Input/Input.tsx';
import s from './AuthPanel.module.css';

/* ------------------------------------------------------------------ model */

export type AuthMode = 'login' | 'register';

/** Canonical order of the switcher. Login first — it is what a returning member wants. */
export const AUTH_MODES: readonly AuthMode[] = ['login', 'register'];

export interface AuthSubmit {
  mode: AuthMode;
  email: string;
  password: string;
  displayName?: string;
  hubUrl: string;
}

/**
 * `display_name` suggested from the address — the local part, verbatim.
 *
 * Deliberately dumb: no capitalising, no splitting on dots. The hub's `member.display_name`
 * (architecture §9.1) is what other people will see next to this member's colour, so guessing at
 * a "prettier" form here would put words in their mouth. The field stays editable and the panel
 * only pre-fills the placeholder.
 */
export function displayNameFromEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  return (at > 0 ? trimmed.slice(0, at) : trimmed).trim();
}

/* ----------------------------------------------------------------- labels */

export interface AuthPanelLabels {
  /** Accessible name of the whole panel. */
  region: string;
  productName: string;
  /** One line under the name saying what the product is. No promises the product does not keep. */
  tagline: string;
  /** Accessible name of the Вход / Регистрация switcher. */
  modeGroup: string;
  login: string;
  register: string;
  email: string;
  emailPlaceholder: string;
  password: string;
  displayName: string;
  /** Says the field may be left alone — the placeholder already shows what will be used. */
  displayNameHint: string;
  submitLogin: string;
  submitRegister: string;
  /** Button label while the request is in flight. */
  busyLogin: string;
  busyRegister: string;
  /** Accessible name of the live region that carries the server's answer. */
  statusRegion: string;
  /** Summary of the collapsed hub-address block. */
  hubToggle: string;
  hubField: string;
  hubHint: string;
  /** The keychain promise, one line. Wording lifted from `CredentialGuarantee`. */
  guarantee: string;
}

export type AuthPanelLabelsInput = Partial<AuthPanelLabels>;

export const AUTH_PANEL_LABELS: AuthPanelLabels = {
  region: 'Вход в PartyCo',
  productName: 'PartyCo',
  tagline: 'Совместная разработка с ИИ на своём сервере.',
  modeGroup: 'Вход или регистрация',
  login: 'Вход',
  register: 'Регистрация',
  email: 'Почта',
  emailPlaceholder: 'you@example.com',
  password: 'Пароль',
  displayName: 'Имя',
  displayNameHint: 'Необязательно — иначе возьмём из почты.',
  submitLogin: 'Войти',
  submitRegister: 'Создать аккаунт',
  busyLogin: 'Входим…',
  busyRegister: 'Создаём…',
  statusRegion: 'Ответ хаба',
  hubToggle: 'Подключиться к другому хабу',
  hubField: 'Адрес хаба',
  hubHint: 'Сервер команды. Обычно менять не нужно.',
  guarantee:
    'Ключи не покидают эту машину: API-ключи провайдеров остаются на твоём компьютере, ' +
    'хаб видит только имя модели и счётчик токенов.',
};

/* ------------------------------------------------------------------ props */

/**
 * Who draws the furniture around the form.
 *
 * `card` — the panel itself: its own frame, the brand header and the keychain footer. This is the
 * shape `apps/desktop` has been mounting since before there was a design, so it stays the default
 * and that call site needs no edit.
 *
 * `bare` — the host screen draws all three and the panel renders only what is actually the form:
 * the Вход/Регистрация switcher, the fields, the submit, the server's answer and the folded hub
 * address. `SignInScreen` mounts it this way, which is why the sign-in screen has exactly one mark
 * and one keychain promise on it rather than two of each.
 */
export type AuthPanelChrome = 'card' | 'bare';

export interface AuthPanelProps {
  /** Active tab. Omit and the panel keeps the choice itself. */
  mode?: AuthMode | undefined;
  onModeChange?: ((mode: AuthMode) => void) | undefined;
  /** Вызывается на отправку. Всю сеть делает вызывающий — компонент не знает про fetch. */
  onSubmit: (input: AuthSubmit) => void;
  /** Идёт запрос. */
  busy?: boolean | undefined;
  /**
   * Человеческий текст ошибки от сервера.
   *
   * Owned by the caller: switching the tab does not clear it, because the panel has no way to know
   * whether the message still applies. Clear it in `onModeChange`.
   */
  error?: string | null | undefined;
  /** Адрес хаба по умолчанию. Changing it re-seeds the collapsed field. */
  hubUrl: string;
  /** Default `card`. See `AuthPanelChrome`. */
  chrome?: AuthPanelChrome | undefined;
  labels?: AuthPanelLabelsInput | undefined;
  className?: string | undefined;
}

/* -------------------------------------------------------------- component */

/**
 * The first screen: sign in or create an account on this hub.
 *
 * **No longer provisional.** Screen 01 of `design/raw/PartyCo Shell.dc.html` (lines 394–475) drew
 * this panel, and the designer's own note on it is that nothing was invented: «Копия взята из
 * `AUTH_PANEL_LABELS` — панель уже написана, ей не хватало только вида». So the composition here is
 * unchanged from what shipped; what the design changed is the dress — an inline switcher instead of
 * a stretched one, roomier fields, a 40px submit, and a hub row that shows the address it would
 * connect to instead of hiding it behind a word.
 *
 * The designer also removed two things from the door: the theme and the density pickers. They were
 * never in this panel, so nothing had to go — recorded here because their absence is now deliberate
 * rather than accidental. «Человек, который ещё не видел продукта, не может осмысленно выбрать
 * плотность строки — это настройка, а не вопрос при знакомстве.»
 *
 * Three deliberate decisions:
 *
 * 1. **The server error is a line, not an `ErrorState`.** `ErrorState` is a centred block with a
 *    24px glyph, a title, a description and a retry button — the shape of "this panel failed to
 *    load", not of «неверная почта или пароль». It also announces with `role="alert"`, which
 *    interrupts; a wrong password is expected, not an emergency. So the message is one line in the
 *    danger colour (status colour in its text role, CONVENTIONS §5) inside a permanently mounted
 *    `aria-live="polite"` region, wired to the form with `aria-describedby`.
 * 2. **`CredentialGuarantee` is too big for the door, so only its words are reused.** That card
 *    needs `storeName` and two counters — facts nobody has before the daemon is up. Rendering it
 *    with zeroes would be a claim, not a guarantee. The footer therefore restates its own sentence
 *    («Ключи не покидают эту машину…») with the same keychain glyph in the same success colour.
 *    Under `chrome='bare'` even that footer belongs to the host, so the screen states the promise
 *    once.
 * 3. **No browser validation.** The form is `noValidate` on purpose: `type="email"` stays for the
 *    keyboard and for autofill, but the only thing this panel refuses is an empty required field —
 *    everything else is the hub's answer, in Russian, in the status line.
 *
 * Passwords for the hub account are not provider credentials: the hub stores them, model-provider
 * API keys never reach it. That distinction is the footer's whole job.
 */
export function AuthPanel({
  mode,
  onModeChange,
  onSubmit,
  busy = false,
  error,
  hubUrl,
  chrome = 'card',
  labels,
  className,
}: AuthPanelProps): ReactElement {
  const t: AuthPanelLabels = labels ? { ...AUTH_PANEL_LABELS, ...labels } : AUTH_PANEL_LABELS;

  const autoId = useId();
  const titleId = `pc-auth-${autoId}-title`;
  const statusId = `pc-auth-${autoId}-status`;

  const [modeState, setModeState] = useState<AuthMode>(mode ?? 'login');
  const active: AuthMode = mode ?? modeState;
  const registering = active === 'register';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  /*
   * The hub address is a draft the member may edit, seeded from the prop. Re-seeding is done during
   * render rather than in an effect — the React-documented way to adjust state when a prop changes,
   * and it avoids a frame where the field shows the old hub.
   */
  const [hubSeed, setHubSeed] = useState(hubUrl);
  const [hubDraft, setHubDraft] = useState(hubUrl);
  if (hubSeed !== hubUrl) {
    setHubSeed(hubUrl);
    setHubDraft(hubUrl);
  }

  const segments = useRef(new Map<AuthMode, HTMLButtonElement | null>());

  const selectMode = useCallback(
    (next: AuthMode): void => {
      if (next === active) return;
      if (mode === undefined) setModeState(next);
      onModeChange?.(next);
    },
    [active, mode, onModeChange],
  );

  const moveMode = useCallback(
    (direction: 1 | -1): void => {
      const at = AUTH_MODES.indexOf(active);
      const next = AUTH_MODES[(at + direction + AUTH_MODES.length) % AUTH_MODES.length];
      if (!next) return;
      selectMode(next);
      segments.current.get(next)?.focus();
    },
    [active, selectMode],
  );

  function onSegmentKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveMode(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveMode(-1);
        break;
      case 'Home':
        event.preventDefault();
        selectMode('login');
        segments.current.get('login')?.focus();
        break;
      case 'End':
        event.preventDefault();
        selectMode('register');
        segments.current.get('register')?.focus();
        break;
      default:
        break;
    }
  }

  const suggestedName = displayNameFromEmail(email);
  // The only validation the panel performs: nothing may be blank. The hub decides the rest.
  const filled = email.trim() !== '' && password !== '' && hubDraft.trim() !== '';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !filled) return;

    const payload: AuthSubmit = {
      mode: active,
      email: email.trim(),
      // Never trimmed — a leading or trailing space is part of the password the member chose.
      password,
      hubUrl: hubDraft.trim(),
    };
    if (registering) {
      const name = displayName.trim() || suggestedName;
      if (name !== '') payload.displayName = name;
    }
    onSubmit(payload);
  }

  const message = error !== null && error !== undefined && error !== '' ? error : null;

  return (
    <section
      className={[s.root, className ?? ''].filter(Boolean).join(' ')}
      data-chrome={chrome}
      aria-label={t.region}
    >
      {chrome === 'card' ? (
        <header className={s.brand}>
          {/* Same mark as the title bar: chrome accent, three pips. It stands for the app, never for a person. */}
          <span className={s.mark} aria-hidden="true">
            <span className={s.pip} data-pip="a" />
            <span className={s.pip} data-pip="b" />
            <span className={s.pip} data-pip="c" />
          </span>
          <span className={s.wordmark}>
            <span className={s.productName} id={titleId}>
              {t.productName}
            </span>
            <span className={s.tagline}>{t.tagline}</span>
          </span>
        </header>
      ) : null}

      <div
        className={s.segmented}
        role="radiogroup"
        aria-label={t.modeGroup}
        onKeyDown={onSegmentKeyDown}
      >
        {AUTH_MODES.map((item) => {
          const selected = item === active;
          return (
            <button
              key={item}
              ref={(node) => {
                segments.current.set(item, node);
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              className={s.segment}
              data-active={selected || undefined}
              onClick={() => selectMode(item)}
            >
              {item === 'login' ? t.login : t.register}
            </button>
          );
        })}
      </div>

      <form
        className={s.form}
        /* See the class JSDoc: the browser's own bubbles are the wrong voice for this screen. */
        noValidate
        /*
         * Named after what it does, and renamed when the tab flips. A `<form>` without an
         * accessible name is a generic element, and `aria-describedby` on a generic element is
         * dropped by most screen readers — so the name is what makes the error association real.
         */
        aria-label={registering ? t.submitRegister : t.submitLogin}
        aria-busy={busy || undefined}
        aria-describedby={message ? statusId : undefined}
        onSubmit={handleSubmit}
      >
        <div className={s.fields}>
          <Input
            label={t.email}
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t.emailPlaceholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <Input
            label={t.password}
            type="password"
            name="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {registering ? (
            <Input
              label={t.displayName}
              type="text"
              name="name"
              autoComplete="name"
              hint={t.displayNameHint}
              placeholder={suggestedName}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          ) : null}
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          className={s.submit}
          loading={busy}
          loadingLabel={registering ? t.busyRegister : t.busyLogin}
          disabled={!filled}
        >
          {registering ? t.submitRegister : t.submitLogin}
        </Button>

        {/*
         * Mounted even when empty so the live region exists before the message does — a region
         * inserted together with its text is announced unreliably. Empty, it collapses in CSS.
         *
         * Under the button rather than over it, as the design draws it: this is the answer to
         * pressing that button, and «На эту почту аккаунт уже есть» read before the button has been
         * pressed is a warning about nothing.
         */}
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

        {/*
         * Self-hosted means the address has to be changeable; 99% of launches use the default, so it
         * stays folded. Native <details>, like ErrorState — the disclosure is keyboard-reachable and
         * announced without a line of script. The address rides on the closed summary because the
         * one thing a person wants from a folded hub row is to check it is still the right hub.
         */}
        <details className={s.hub}>
          <summary className={s.hubSummary}>
            <Icon name="chevron-right" className={s.hubChevron} />
            <span className={s.hubLabel}>{t.hubToggle}</span>
            <span className={s.hubAddress}>{hubDraft}</span>
          </summary>
          <div className={s.hubBody}>
            <Input
              label={t.hubField}
              type="text"
              name="hub"
              mono
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              hint={t.hubHint}
              value={hubDraft}
              onChange={(event) => setHubDraft(event.target.value)}
            />
          </div>
        </details>
      </form>

      {chrome === 'card' ? (
        <footer className={s.footer}>
          <Icon name="keychain" className={s.guaranteeGlyph} />
          <span className={s.guaranteeText}>{t.guarantee}</span>
        </footer>
      ) : null}
    </section>
  );
}
