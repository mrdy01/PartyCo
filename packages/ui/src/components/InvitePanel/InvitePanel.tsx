import {
  useCallback,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from '@partyco/icons';
import {
  INVITABLE_ROLES,
  INVITE_LIFETIME_LABEL,
  INVITE_SEATS_LABEL,
  INVITE_STATUS_LABEL,
  INVITE_STATUS_TONE,
  PROJECT_ROLE_ABILITY,
  PROJECT_ROLE_TITLE,
  type InviteChannel,
  type InviteLifetime,
  type InviteRecord,
  type InviteSeats,
  type ProjectRole,
} from '../AppShell/model.ts';
import { Button } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { IconButton } from '../IconButton/IconButton.tsx';
import { Input } from '../Input/Input.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import s from './InvitePanel.module.css';

/* ----------------------------------------------------------------- labels */

export interface InvitePanelLabels {
  title: string;
  close: string;
  /** The two channels, as the segmented switch names them. */
  channel: Record<InviteChannel, string>;
  /** Accessible name of the channel switch. */
  channelGroup: string;

  /* by e-mail */
  emailField: string;
  emailPlaceholder: string;
  roleSection: string;
  send: string;
  sending: string;
  /** Why a link is shown next to the mail form. */
  linkNote: ReactNode;
  copy: string;
  copyLink: string;
  sentSection: string;
  sentList: string;
  sentEmpty: string;

  /* by code */
  codeField: string;
  /** Shown instead of the code box while the hub has not issued a code. */
  codeEmpty: string;
  /**
   * Action of that empty state. Distinct from `rotate` on purpose: «Сменить код» under «Кода пока
   * нет» offers to change a thing that does not exist yet.
   */
  codeCreate: string;
  /** Footnote under the big code — why it has no look-alike characters. */
  alphabetNote: ReactNode;
  lifetime: string;
  seats: string;
  rotate: string;
  disable: string;
  /** Quiet line to the right of «Сменить код» / «Отключить». */
  rotateNote: string;
  /** Closing footnote next to the `keychain` glyph. */
  codeFootnote: ReactNode;

  /* states */
  errorTitle: string;
  errorBody: string;
  retry: string;
  loading: string;
}

export const INVITE_PANEL_LABELS: InvitePanelLabels = {
  title: 'Позвать в проект',
  close: 'Закрыть приглашение',
  channel: { email: 'По почте', code: 'По коду' },
  channelGroup: 'Как позвать',

  emailField: 'Почта',
  emailPlaceholder: 'имя@команда.dev',
  roleSection: 'Что ему можно',
  send: 'Отправить приглашение',
  sending: 'Отправляем',
  linkNote: 'Хаб отправит письмо, если у него настроена почта. Если нет — вот та же ссылка, отправь её как удобно.',
  copy: 'Скопировать',
  copyLink: 'Скопировать ссылку',
  sentSection: 'Уже отправлено',
  sentList: 'Отправленные приглашения',
  sentEmpty: 'Ты ещё никого не звал по почте.',

  codeField: 'Код проекта',
  codeEmpty: 'Кода пока нет — хаб выдаст его, как только ты попросишь.',
  codeCreate: 'Выдать код',
  alphabetNote: 'Только латиница и цифры, без похожих знаков: ни O, ни 0, ни I, ни l. Такой код читается голосом с первого раза.',
  lifetime: 'Сколько живёт',
  seats: 'Сколько человек пустит',
  rotate: 'Сменить код',
  disable: 'Отключить',
  rotateNote: 'Старый код перестанет пускать сразу',
  codeFootnote: 'Код пускает в проект, а не на твою машину. Ключи провайдеров, файлы и зоны остаются локальными — код даёт только место в команде на хабе.',

  errorTitle: 'Не получилось открыть приглашения',
  errorBody: 'Хаб не ответил. Уже выданные коды и письма продолжают работать — это только форма.',
  retry: 'Попробовать снова',
  loading: 'Спрашиваем хаб про приглашения',
};

export type InvitePanelLabelsInput = Partial<Omit<InvitePanelLabels, 'channel'>> & {
  channel?: Partial<Record<InviteChannel, string>> | undefined;
};

/**
 * Merge one level deeper than a spread. `channel` is a record, and a shallow merge would let a
 * caller who wanted to rename one tab silently delete the other — the failure mode that once wiped
 * a whole block of copy on a neighbouring screen.
 */
function mergeLabels(input?: InvitePanelLabelsInput): InvitePanelLabels {
  if (!input) return INVITE_PANEL_LABELS;
  return {
    ...INVITE_PANEL_LABELS,
    ...input,
    channel: { ...INVITE_PANEL_LABELS.channel, ...input.channel },
  };
}

/* -------------------------------------------------------------- segmented */

interface SegmentedOption<T extends string> {
  id: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: ((value: T) => void) | undefined;
  label: string;
  /** `sm` is the pair inside the code tab; `md` is the channel switch at the top. */
  size?: 'sm' | 'md';
}

/**
 * The pill switch used three times in this panel.
 *
 * A radio group rather than tabs: the two channels are one choice with one answer, and the
 * lifetime / seat switches below are the same shape. Roving tabindex and arrow keys are what the
 * radiogroup pattern requires — one stop in the tab order, arrows inside it.
 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: SegmentedProps<T>): ReactElement {
  const buttons = useRef(new Map<T, HTMLButtonElement | null>());

  const move = useCallback(
    (direction: 1 | -1) => {
      // Without a handler the switch cannot change: moving focus would then leave it on a radio
      // that is not the checked one, and the roving tabindex would point somewhere else again.
      if (!onChange || options.length === 0) return;
      const at = options.findIndex((option) => option.id === value);
      const next = options[(at + direction + options.length) % options.length];
      if (!next) return;
      onChange?.(next.id);
      buttons.current.get(next.id)?.focus();
    },
    [onChange, options, value],
  );

  const jump = useCallback(
    (which: 'first' | 'last') => {
      if (!onChange) return;
      const next = which === 'first' ? options[0] : options[options.length - 1];
      if (!next) return;
      onChange?.(next.id);
      buttons.current.get(next.id)?.focus();
    },
    [onChange, options],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          move(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          move(-1);
          break;
        case 'Home':
          event.preventDefault();
          jump('first');
          break;
        case 'End':
          event.preventDefault();
          jump('last');
          break;
        default:
          break;
      }
    },
    [jump, move],
  );

  return (
    <div
      className={s.segmented}
      data-size={size}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            ref={(node) => {
              buttons.current.set(option.id, node);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={s.segment}
            data-active={active || undefined}
            onClick={() => onChange?.(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ props */

/** Convention §6: the three states are declared, not deferred. */
export type InvitePanelState = 'ready' | 'loading' | 'error';

/**
 * `card` is how the export draws it — a free-standing 520px block with its own frame. `docked` is
 * the same content in the shell's detail slot, which already supplies the edge and the height, so
 * a second border there would draw a line beside a line.
 */
export type InvitePanelVariant = 'card' | 'docked';

export interface InvitePanelProps {
  variant?: InvitePanelVariant | undefined;
  /** Which form is showing. Controlled — the panel keeps no channel state of its own. */
  channel: InviteChannel;
  onChannelChange?: ((channel: InviteChannel) => void) | undefined;

  /* ---- by e-mail ---- */
  email?: string | undefined;
  onEmailChange?: ((email: string) => void) | undefined;
  /** Validation message under the field. */
  emailError?: string | undefined;
  /** Role the invitation would hand out. */
  role: ProjectRole;
  onRoleChange?: ((role: ProjectRole) => void) | undefined;
  /** Which roles may be offered. Defaults to `INVITABLE_ROLES` — the owner is never among them. */
  roles?: readonly ProjectRole[] | undefined;
  onSend?: (() => void) | undefined;
  /** In-flight send: the button spins and stops accepting clicks. */
  sending?: boolean | undefined;
  /** Invitations already sent. Empty renders the list's empty state, never nothing. */
  sentInvites?: readonly InviteRecord[] | undefined;
  /** Runs an invitation's trailing action («Отменить», «Позвать снова»). */
  onInviteAction?: ((invite: InviteRecord) => void) | undefined;

  /* ---- by code ---- */
  /** `HTAK-4K7M-9ZQD`. Absent while the hub has not issued one yet. */
  code?: string | undefined;
  /** The join URL. Shown on both tabs — it is the same invitation either way. */
  link?: string | undefined;
  lifetime?: InviteLifetime | undefined;
  onLifetimeChange?: ((lifetime: InviteLifetime) => void) | undefined;
  seats?: InviteSeats | undefined;
  onSeatsChange?: ((seats: InviteSeats) => void) | undefined;
  onRotate?: (() => void) | undefined;
  onDisable?: (() => void) | undefined;

  /**
   * Puts `text` on the clipboard. The component never touches `navigator.clipboard` itself —
   * it does not know what platform it is on (convention §8). Omit and no copy control is drawn.
   */
  onCopy?: ((text: string) => void) | undefined;

  state?: InvitePanelState | undefined;
  onClose?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  labels?: InvitePanelLabelsInput | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------- sub-blocks */

interface CopyRowProps {
  text: string;
  actionLabel: string;
  onCopy: ((text: string) => void) | undefined;
  /** Draws the `copy` glyph next to the label. The code tab's link row shows the words alone. */
  withGlyph?: boolean;
}

function CopyRow({ text, actionLabel, onCopy, withGlyph = false }: CopyRowProps): ReactElement {
  return (
    <div className={s.linkRow}>
      <span className={s.linkText}>{text}</span>
      {onCopy ? (
        <button type="button" className={s.copyLink} onClick={() => onCopy(text)}>
          {withGlyph ? <Icon name="copy" className={s.copyGlyph} /> : null}
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

interface SentRowProps {
  invite: InviteRecord;
  onAction: ((invite: InviteRecord) => void) | undefined;
}

/**
 * One already-sent invitation. Status is a dot plus a word — never a fill — and the dot carries an
 * accessible name so the state is not communicated by colour alone.
 */
function SentRow({ invite, onAction }: SentRowProps): ReactElement {
  const tone = INVITE_STATUS_TONE[invite.status];
  return (
    <li className={s.sentItem}>
      <div className={s.sentRow} data-quiet={tone === null || undefined}>
        <span className={s.sentValue}>{invite.email ?? invite.code}</span>
        <span className={s.sentStatus} data-tone={tone ?? 'muted'}>
          <span
            className={s.dot}
            data-tone={tone ?? 'muted'}
            role="img"
            aria-label={INVITE_STATUS_LABEL[invite.status]}
          />
          <span className={s.sentMeta}>{invite.meta}</span>
        </span>
        {invite.action && onAction ? (
          <button type="button" className={s.rowAction} onClick={() => onAction(invite)}>
            {invite.action.label}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ panel */

/**
 * «Позвать в проект» — the two ways a person joins a hub.
 *
 * By mail the hub sends the letter itself when SMTP is configured; when it is not, the same link is
 * put in the inviter's hands rather than the flow dead-ending — which is why the link row sits under
 * the mail form and not only on the code tab.
 *
 * The role list is a real `<fieldset>` of real radios: it is the one control here that changes what
 * another person may do to the repository, and it must behave exactly like the platform's own.
 * `owner` is absent from it by construction — see `INVITABLE_ROLES` in model.ts.
 */
export function InvitePanel({
  variant = 'card',
  channel,
  onChannelChange,
  email = '',
  onEmailChange,
  emailError,
  role,
  onRoleChange,
  roles = INVITABLE_ROLES,
  onSend,
  sending = false,
  sentInvites,
  onInviteAction,
  code,
  link,
  lifetime = 'day',
  onLifetimeChange,
  seats = 'five',
  onSeatsChange,
  onRotate,
  onDisable,
  onCopy,
  state = 'ready',
  onClose,
  onRetry,
  labels,
  className,
}: InvitePanelProps): ReactElement {
  const copy = mergeLabels(labels);
  const groupName = useId();
  const sent = sentInvites ?? [];

  const channelOptions: readonly SegmentedOption<InviteChannel>[] = [
    { id: 'email', label: copy.channel.email },
    { id: 'code', label: copy.channel.code },
  ];

  const lifetimeOptions: readonly SegmentedOption<InviteLifetime>[] = (
    ['day', 'week', 'forever'] as const
  ).map((id) => ({ id, label: INVITE_LIFETIME_LABEL[id] }));

  const seatOptions: readonly SegmentedOption<InviteSeats>[] = (['one', 'five', 'any'] as const).map(
    (id) => ({ id, label: INVITE_SEATS_LABEL[id] }),
  );

  const header = (
    <header className={s.header}>
      <h2 className={s.title}>{copy.title}</h2>
      {onClose ? (
        <IconButton
          icon="close"
          label={copy.close}
          variant="ghost"
          size="sm"
          className={s.close}
          onClick={onClose}
        />
      ) : null}
    </header>
  );

  if (state === 'loading') {
    return (
      <section className={cx(s.panel, className)} data-variant={variant} aria-label={copy.title}>
        {header}
        <div className={s.stateBody}>
          <LoadingState rows={5} caption={copy.loading} label={copy.loading} />
        </div>
      </section>
    );
  }

  if (state === 'error') {
    return (
      <section className={cx(s.panel, className)} data-variant={variant} aria-label={copy.title}>
        {header}
        <div className={s.stateBody}>
          <ErrorState
            title={copy.errorTitle}
            description={copy.errorBody}
            {...(onRetry ? { onRetry } : {})}
            retryLabel={copy.retry}
          />
        </div>
      </section>
    );
  }

  const byEmail = (
    <>
      <Input
        label={copy.emailField}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder={copy.emailPlaceholder}
        value={email}
        {...(emailError !== undefined ? { error: emailError } : {})}
        onChange={(event) => onEmailChange?.(event.currentTarget.value)}
      />

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>{copy.roleSection}</legend>
        <div className={s.roleList}>
          {roles.map((option) => (
            <label key={option} className={s.roleRow}>
              <input
                type="radio"
                className={s.roleInput}
                name={groupName}
                value={option}
                checked={option === role}
                onChange={() => onRoleChange?.(option)}
              />
              <span className={s.radio} aria-hidden="true">
                <span className={s.radioDot} />
              </span>
              <span className={s.roleTitle}>{PROJECT_ROLE_TITLE[option]}</span>
              <span className={s.roleAbility}>{PROJECT_ROLE_ABILITY[option]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {onSend ? (
        <Button
          variant="primary"
          size="lg"
          fullWidth
          className={s.cta}
          loading={sending}
          loadingLabel={copy.sending}
          onClick={onSend}
        >
          {copy.send}
        </Button>
      ) : null}

      <div className={s.block}>
        <p className={s.note}>{copy.linkNote}</p>
        {link ? (
          <CopyRow text={link} actionLabel={copy.copy} onCopy={onCopy} withGlyph />
        ) : null}
      </div>

      <section className={s.section}>
        <h3 className={s.sectionTitle}>{copy.sentSection}</h3>
        {sent.length > 0 ? (
          <ul className={s.sentList} aria-label={copy.sentList}>
            {sent.map((invite) => (
              <SentRow key={invite.id} invite={invite} onAction={onInviteAction} />
            ))}
          </ul>
        ) : (
          <EmptyState title={copy.sentEmpty} className={cx(s.inlineEmpty)} />
        )}
      </section>
    </>
  );

  const byCode = (
    <>
      <section className={s.section}>
        <h3 className={s.sectionTitle}>{copy.codeField}</h3>
        {code ? (
          <div className={s.codeBox}>
            <span className={s.codeValue}>{code}</span>
            {onCopy ? (
              <Button
                variant="secondary"
                size="lg"
                icon="copy"
                className={s.codeCopy}
                onClick={() => onCopy(code)}
              >
                {copy.copy}
              </Button>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon="lease"
            title={copy.codeEmpty}
            className={cx(s.inlineEmpty)}
            {...(onRotate ? { actions: [{ label: copy.codeCreate, onClick: onRotate }] } : {})}
          />
        )}
        <p className={s.quietNote}>{copy.alphabetNote}</p>
      </section>

      <div className={s.switches}>
        <div className={s.switchBlock}>
          <span className={s.sectionTitle}>{copy.lifetime}</span>
          <Segmented
            options={lifetimeOptions}
            value={lifetime}
            onChange={onLifetimeChange}
            label={copy.lifetime}
            size="sm"
          />
        </div>
        <div className={s.switchBlock}>
          <span className={s.sectionTitle}>{copy.seats}</span>
          <Segmented
            options={seatOptions}
            value={seats}
            onChange={onSeatsChange}
            label={copy.seats}
            size="sm"
          />
        </div>
      </div>

      {link ? <CopyRow text={link} actionLabel={copy.copyLink} onCopy={onCopy} /> : null}

      {onRotate || onDisable ? (
        <div className={s.codeActions}>
          {onRotate ? (
            <Button variant="secondary" size="lg" onClick={onRotate}>
              {copy.rotate}
            </Button>
          ) : null}
          {onDisable ? (
            <Button variant="secondary" size="lg" onClick={onDisable}>
              {copy.disable}
            </Button>
          ) : null}
          <span className={s.rotateNote}>{copy.rotateNote}</span>
        </div>
      ) : null}

      <div className={s.footnote}>
        <Icon name="keychain" className={s.footnoteGlyph} />
        <p className={s.footnoteText}>{copy.codeFootnote}</p>
      </div>
    </>
  );

  return (
    <section className={cx(s.panel, className)} data-variant={variant} aria-label={copy.title}>
      {header}
      <div className={s.body}>
        <Segmented
          options={channelOptions}
          value={channel}
          onChange={onChannelChange}
          label={copy.channelGroup}
        />
        {channel === 'email' ? byEmail : byCode}
      </div>
    </section>
  );
}
