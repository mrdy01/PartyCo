import type { ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import { KEY_GUARANTEE } from '../AppShell/model.ts';
import {
  AuthPanel,
  AUTH_PANEL_LABELS,
  type AuthMode,
  type AuthPanelLabelsInput,
  type AuthSubmit,
} from '../AuthPanel/AuthPanel.tsx';
import s from './SignInScreen.module.css';

/* ------------------------------------------------------------------- copy */

export interface SignInCopy {
  /** Accessible name of the screen. */
  region: string;
  productName: string;
  /** One line under the name saying what the product is. */
  tagline: string;
  /** The keychain promise, stated once, before anyone has typed anything. */
  guarantee: string;
}

export type SignInCopyInput = Partial<SignInCopy>;

export const SIGN_IN_COPY: SignInCopy = {
  region: AUTH_PANEL_LABELS.region,
  productName: AUTH_PANEL_LABELS.productName,
  /* Both taken from the panel's own dictionary — the door says one thing, in one place. */
  tagline: AUTH_PANEL_LABELS.tagline,
  guarantee: KEY_GUARANTEE,
};

/* ------------------------------------------------------------------ props */

export interface SignInScreenProps {
  /** Active tab. Omit and the embedded panel keeps the choice itself. */
  mode?: AuthMode | undefined;
  onModeChange?: ((mode: AuthMode) => void) | undefined;
  /** Вызывается на отправку. Всю сеть делает вызывающий. */
  onSubmit: (input: AuthSubmit) => void;
  /** Идёт запрос: кнопка занята, форма помечена `aria-busy`. */
  busy?: boolean | undefined;
  /** Человеческий текст ошибки от хаба. Owned by the caller — see `AuthPanelProps.error`. */
  error?: string | null | undefined;
  hubUrl: string;
  copy?: SignInCopyInput | undefined;
  /** Passed straight through to the form: field names, button labels, the hub row. */
  labels?: AuthPanelLabelsInput | undefined;
  className?: string | undefined;
}

/* -------------------------------------------------------------- component */

/**
 * The whole window before there is an account: one 404px column, centred, nothing else on screen.
 *
 * This is a frame, not a second form. `AuthPanel` already had the fields, the switcher, the folded
 * hub address, the busy state and the server's answer — the export's own note is that nothing new
 * was invented for this screen — so the panel is mounted whole with `chrome='bare'` and this file
 * contributes exactly the three things a screen owns and a form does not: the mark and the name at
 * the top, the centring, and the keychain promise at the bottom.
 *
 * The promise sits under a rule at the very bottom on purpose. It is the one claim a person cannot
 * verify before installing anything, so it is stated where it will be read before the first
 * password is typed rather than in a settings page nobody opens. `CredentialGuarantee` states the
 * same thing with two counters — but the counters are facts the daemon supplies, and the daemon is
 * not running yet, so here it is the sentence and the shield alone.
 *
 * What the designer removed from this screen is as deliberate as what is on it: no theme picker and
 * no density picker. «Человек, который ещё не видел продукта, не может осмысленно выбрать плотность
 * строки — это настройка, а не вопрос при знакомстве.»
 */
export function SignInScreen({
  mode,
  onModeChange,
  onSubmit,
  busy = false,
  error,
  hubUrl,
  copy,
  labels,
  className,
}: SignInScreenProps): ReactElement {
  const t: SignInCopy = copy ? { ...SIGN_IN_COPY, ...copy } : SIGN_IN_COPY;

  return (
    <div className={[s.screen, className ?? ''].filter(Boolean).join(' ')}>
      <section className={s.column} aria-label={t.region}>
        <header className={s.brand}>
          {/*
           * The app's mark: chrome accent, three squares. Never an identity colour — that palette
           * belongs to people, and this stands for the product (CONVENTIONS §5).
           */}
          <span className={s.mark} aria-hidden="true">
            <span className={s.pip} data-pip="a" />
            <span className={s.pip} data-pip="b" />
            <span className={s.pip} data-pip="c" />
          </span>
          {/* A div, not a span: `<h1>` and `<p>` are flow content and may not sit inside phrasing. */}
          <div className={s.wordmark}>
            <h1 className={s.productName}>{t.productName}</h1>
            <p className={s.tagline}>{t.tagline}</p>
          </div>
        </header>

        <AuthPanel
          chrome="bare"
          mode={mode}
          onModeChange={onModeChange}
          onSubmit={onSubmit}
          busy={busy}
          error={error}
          hubUrl={hubUrl}
          labels={labels}
        />

        <footer className={s.guarantee}>
          <Icon name="keychain" className={s.guaranteeGlyph} />
          <p className={s.guaranteeText}>{t.guarantee}</p>
        </footer>
      </section>
    </div>
  );
}
