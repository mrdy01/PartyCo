import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import { zoneEdgeStyle, type Member } from '../../identity.ts';
import { AGENT_MODE_PLAIN_LABEL, type ComposerContext } from '../AppShell/model.ts';
import { ProviderGlyph } from '../ProviderGlyph/ProviderGlyph.tsx';
import styles from './Composer.module.css';

/**
 * `wide` — the composer under the 640px column (export lines 626–637).
 * `narrow` — the 560px pane of screen 04 (lines 803–809): smaller send button, no model chip, no
 * keyboard hint. A variant and not a second component, because everything else is identical.
 */
export type ComposerVariant = 'wide' | 'narrow';

/** What `renderModeMenu` gets, so a popover can close itself after a choice. */
export interface ComposerModeMenuApi {
  close: () => void;
}

export interface ComposerCopy {
  /** Ghost line with the blinking caret. Screen 04 passes «Спросить про этот файл…». */
  placeholder: string;
  /** Accessible name of the textarea — the ghost line is decorative. */
  fieldLabel: string;
  /** Accessible name of the send button. */
  send: string;
  /** Accessible name of the same button while a turn is running. */
  stop: string;
  /** Mono hint left of the send button. */
  submitHint: string;
  zoneLabel: string;
  modeLabel: string;
  modelLabel: string;
}

export const COMPOSER_COPY: ComposerCopy = {
  placeholder: 'Что делаем дальше?',
  fieldLabel: 'Что делаем дальше?',
  send: 'Отправить',
  stop: 'Остановить ход',
  submitHint: 'Ctrl+Enter',
  zoneLabel: 'Зона',
  modeLabel: 'Что агенту разрешено',
  modelLabel: 'Модель',
};

export interface ComposerProps {
  /** Zone, mode, provider and model as the chips currently say them. */
  context: ComposerContext;
  /**
   * The local user. Supplies the identity colour of the zone chip's 2px left edge — role #2. The
   * edge is drawn only when the zone is actually held by this person, i.e. when `context.zoneNote`
   * is present; otherwise it stays transparent and the chip is a plain path.
   */
  self?: Member | undefined;
  /**
   * Which identity palette the zone chip's left edge comes from. Must be the same set the rest of
   * the shell is told, or one chip stays on the jewel palette while the ribbon switches.
   */
  identitySet?: IdentitySetName | undefined;
  /** Controlled text. Omit and the composer keeps its own. */
  value?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  /** Ctrl+Enter / Cmd+Enter, or the send button. Receives the trimmed text. */
  onSubmit?: ((value: string) => void) | undefined;
  variant?: ComposerVariant | undefined;
  /** No typing, no sending — e.g. while the team is unreachable. */
  disabled?: boolean | undefined;
  /**
   * A turn is running right now.
   *
   * Distinct from `disabled` because the two mean opposite things to the reader: `disabled` says
   * «сюда нельзя», `running` says «занято, и это ты его занял». The field stops accepting either
   * way, but only this one has something to offer — see `onStop`.
   */
  running?: boolean | undefined;
  /**
   * Stop the running turn.
   *
   * Present ⇒ the send button becomes a stop button while `running`. Absent ⇒ it stays a greyed-out
   * send button, which is the honest drawing for a caller that genuinely cannot interrupt anything.
   * The engine behind this product can: killing the child process is a supported operation, and for
   * a while it was the only working subsystem on the page with no control anywhere to reach it.
   */
  onStop?: (() => void) | undefined;
  onZoneClick?: (() => void) | undefined;
  /** Used when `renderModeMenu` is absent — then the chip is just a button. */
  onModeClick?: (() => void) | undefined;
  onModelClick?: (() => void) | undefined;
  /**
   * Optional popover over the mode chip — `AgentModeSelector` belongs here, rendered by the caller
   * so this component never forks it. Present ⇒ the chip toggles the popover instead of calling
   * `onModeClick`.
   */
  renderModeMenu?: ((api: ComposerModeMenuApi) => ReactNode) | undefined;
  /** Status tone of the mode dot. The design draws warning; a stricter mode may want another. */
  modeTone?: 'success' | 'warning' | 'danger' | 'running' | undefined;
  copy?: Partial<ComposerCopy> | undefined;
  autoFocus?: boolean | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The one place a person says what to do next.
 *
 * The caret in the ghost line blinks only while the field is empty **and** unfocused: once there is
 * a real caret, a second painted one is a lie about where typing lands. The native placeholder is
 * suppressed under the ghost and comes back on focus, so assistive tech always has the text.
 */
export function Composer({
  context,
  self,
  identitySet,
  value,
  onValueChange,
  onSubmit,
  variant = 'wide',
  disabled = false,
  running = false,
  onStop,
  onZoneClick,
  onModeClick,
  onModelClick,
  renderModeMenu,
  modeTone = 'warning',
  copy,
  autoFocus = false,
  className,
}: ComposerProps): ReactElement {
  const text: ComposerCopy = copy ? { ...COMPOSER_COPY, ...copy } : COMPOSER_COPY;

  const controlled = value !== undefined;
  const [inner, setInner] = useState('');
  const draft = controlled ? value : inner;

  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const modeSlotRef = useRef<HTMLDivElement>(null);

  /**
   * Auto-grow. The height is measured from the content, so it is one of the few numbers that
   * genuinely cannot come from a token (CONVENTIONS §2 allows exactly this case). The ceiling does
   * live in CSS — `max-height` on `.field`.
   */
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && modeSlotRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuOpen]);

  const canSend = !disabled && draft.trim().length > 0;
  // Stopping is offered only when there is both something to stop and somebody able to stop it.
  const canStop = running && Boolean(onStop);

  const submit = useCallback(() => {
    const payload = draft.trim();
    if (disabled || payload.length === 0) return;
    onSubmit?.(payload);
    if (!controlled) setInner('');
  }, [controlled, disabled, draft, onSubmit]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  /*
   * The painted ghost carries a blinking caret, and a blinking caret is a promise that typing lands
   * here. A disabled field keeps its native placeholder instead — the words stay, the promise goes.
   */
  const showGhost = draft.length === 0 && !focused && !disabled;

  const zoneEdge = zoneEdgeStyle(self && context.zoneNote ? self.colorSlug : null, identitySet);

  const zoneChipBody = (
    <>
      <span className={styles.zonePath}>{context.zonePath}</span>
      {context.zoneNote ? <span className={styles.zoneNote}>{context.zoneNote}</span> : null}
    </>
  );

  /**
   * The caret is drawn only when the chip actually opens something.
   *
   * It used to be unconditional, and the chip degrades to a `<span>` when the caller passes no
   * handler — so in the product it read as a menu, did nothing when clicked, and taught the person
   * that this interface has dead controls in it. A downward chevron is a promise; the component may
   * only make it when it can keep it.
   */
  const modeInteractive = Boolean(renderModeMenu) || Boolean(onModeClick);

  const modeChipBody = (
    <>
      <span className={styles.modeDot} data-tone={modeTone} aria-hidden="true" />
      <span className={styles.modeLabel}>{AGENT_MODE_PLAIN_LABEL[context.mode]}</span>
      {modeInteractive ? <Icon name="caret-down" className={styles.caret} /> : null}
    </>
  );

  const modelChipBody = (
    <>
      <ProviderGlyph providerId={context.providerId} />
      <span className={styles.modelName}>{context.modelLabel}</span>
    </>
  );

  return (
    <div
      className={cx(styles.root, className)}
      data-variant={variant}
      data-focused={focused ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
    >
      <div className={styles.fieldWrap}>
        <textarea
          ref={fieldRef}
          className={styles.field}
          rows={1}
          value={draft}
          placeholder={text.placeholder}
          aria-label={text.fieldLabel}
          data-ghost={showGhost ? 'true' : undefined}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(event) => {
            const next = event.target.value;
            if (!controlled) setInner(next);
            onValueChange?.(next);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
        />
        {showGhost ? (
          <span className={styles.ghost} aria-hidden="true">
            {text.placeholder}
            <span className={styles.caretBar} />
          </span>
        ) : null}
      </div>

      <div className={styles.chips}>
        {context.zonePath ? (
          onZoneClick ? (
            <button
              type="button"
              className={cx(styles.chip, styles.chipButton)}
              style={zoneEdge}
              onClick={onZoneClick}
              aria-label={`${text.zoneLabel}: ${context.zonePath}`}
            >
              {zoneChipBody}
            </button>
          ) : (
            <span className={styles.chip} style={zoneEdge} title={`${text.zoneLabel}: ${context.zonePath}`}>
              {zoneChipBody}
            </span>
          )
        ) : null}

        <div className={styles.modeSlot} ref={modeSlotRef}>
          {modeInteractive ? (
            <button
              type="button"
              className={cx(styles.chip, styles.chipButton)}
              onClick={() => {
                if (renderModeMenu) {
                  setMenuOpen((open) => !open);
                  return;
                }
                onModeClick?.();
              }}
              aria-label={`${text.modeLabel}: ${AGENT_MODE_PLAIN_LABEL[context.mode]}`}
              {...(renderModeMenu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menuOpen } : {})}
            >
              {modeChipBody}
            </button>
          ) : (
            <span
              className={styles.chip}
              title={`${text.modeLabel}: ${AGENT_MODE_PLAIN_LABEL[context.mode]}`}
            >
              {modeChipBody}
            </span>
          )}
          {renderModeMenu && menuOpen ? (
            <div className={styles.menu}>{renderModeMenu({ close: () => setMenuOpen(false) })}</div>
          ) : null}
        </div>

        {variant === 'wide' ? (
          onModelClick ? (
            <button
              type="button"
              className={cx(styles.chip, styles.chipButton)}
              onClick={onModelClick}
              aria-label={`${text.modelLabel}: ${context.modelLabel}`}
            >
              {modelChipBody}
            </button>
          ) : (
            <span className={styles.chip} title={`${text.modelLabel}: ${context.modelLabel}`}>
              {modelChipBody}
            </span>
          )
        ) : null}

        <div className={styles.trailing}>
          {variant === 'wide' ? <span className={styles.hint}>{text.submitHint}</span> : null}
          <button
            type="button"
            className={styles.send}
            data-stop={canStop ? 'true' : undefined}
            onClick={canStop ? onStop : submit}
            disabled={canStop ? false : !canSend}
            aria-label={canStop ? text.stop : text.send}
            title={canStop ? text.stop : `${text.send} · ${text.submitHint}`}
          >
            <Icon name={canStop ? 'close' : 'send'} className={styles.sendGlyph} />
          </button>
        </div>
      </div>
    </div>
  );
}
