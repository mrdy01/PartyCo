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
import { AGENT_MODE_PLAIN_LABEL, AGENT_MODE_TONE, type ComposerContext } from '../AppShell/model.ts';
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
  /** Used when `renderModelMenu` is absent — then the chip is just a button. */
  onModelClick?: (() => void) | undefined;
  /**
   * Optional popover over the mode chip, rendered by the caller so this component never forks a
   * picker. Present ⇒ the chip toggles the popover instead of calling `onModeClick`, which is a
   * precedence worth stating: passing both means the click handler is never reached.
   */
  renderModeMenu?: ((api: ComposerModeMenuApi) => ReactNode) | undefined;
  /** The same arrangement for the model chip, and the same precedence over `onModelClick`. */
  renderModelMenu?: ((api: ComposerModeMenuApi) => ReactNode) | undefined;
  /**
   * Status tone of the mode dot.
   *
   * Defaulted from the mode itself rather than fixed at `warning`. With three modes behind one dot a
   * single colour makes «Правит в своей зоне» and «Сам решает» indistinguishable — and those two are
   * exactly the pair a person needs to tell apart at a glance, because one of them is bounded by the
   * zone and the other is not. A caller may still override.
   */
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
  renderModelMenu,
  modeTone,
  copy,
  autoFocus = false,
  className,
}: ComposerProps): ReactElement {
  const text: ComposerCopy = copy ? { ...COMPOSER_COPY, ...copy } : COMPOSER_COPY;

  const controlled = value !== undefined;
  const [inner, setInner] = useState('');
  const draft = controlled ? value : inner;

  const [focused, setFocused] = useState(false);
  /** At most one chip menu is open at a time — two popovers over one row is two answers to one row. */
  const [openMenu, setOpenMenu] = useState<'mode' | 'model' | null>(null);

  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const modeSlotRef = useRef<HTMLDivElement>(null);
  const modelSlotRef = useRef<HTMLDivElement>(null);

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
    if (openMenu === null) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setOpenMenu(null);
        return;
      }
      // A click inside the open menu's own slot is not an outside click — and the slot is whichever
      // chip is open, so the two menus cannot close each other's clicks.
      const slot = openMenu === 'mode' ? modeSlotRef.current : modelSlotRef.current;
      if (slot?.contains(target)) return;
      setOpenMenu(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openMenu]);

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
  const modelInteractive = Boolean(renderModelMenu) || Boolean(onModelClick);

  const modeChipBody = (
    <>
      <span
        className={styles.modeDot}
        data-tone={modeTone ?? AGENT_MODE_TONE[context.mode]}
        aria-hidden="true"
      />
      <span className={styles.modeLabel}>{AGENT_MODE_PLAIN_LABEL[context.mode]}</span>
      {modeInteractive ? <Icon name="caret-down" className={styles.caret} /> : null}
    </>
  );

  const modelChipBody = (
    <>
      <ProviderGlyph providerId={context.providerId} />
      <span className={styles.modelName}>{context.modelLabel}</span>
      {modelInteractive ? <Icon name="caret-down" className={styles.caret} /> : null}
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

        <div className={styles.slot} ref={modeSlotRef}>
          {modeInteractive ? (
            <button
              type="button"
              className={cx(styles.chip, styles.chipButton)}
              onClick={() => {
                if (renderModeMenu) {
                  setOpenMenu((open) => (open === 'mode' ? null : 'mode'));
                  return;
                }
                onModeClick?.();
              }}
              aria-label={`${text.modeLabel}: ${AGENT_MODE_PLAIN_LABEL[context.mode]}`}
              {...(renderModeMenu
                ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': openMenu === 'mode' }
                : {})}
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
          {renderModeMenu && openMenu === 'mode' ? (
            <div className={styles.menu}>{renderModeMenu({ close: () => setOpenMenu(null) })}</div>
          ) : null}
        </div>

        {/*
          The model chip is drawn in the narrow composer too, which the export does not do (screen 04
          shows the chip row without it). Deliberate: with a file open the question is usually about
          that file, and hiding the control there means the only way to change which model answers is
          to close the file first. The hint beside the send button stays wide-only, so the row does
          not outgrow the pane. Flagged to the designer.
        */}
        <div className={styles.slot} ref={modelSlotRef}>
          {modelInteractive ? (
            <button
              type="button"
              className={cx(styles.chip, styles.chipButton)}
              onClick={() => {
                if (renderModelMenu) {
                  setOpenMenu((open) => (open === 'model' ? null : 'model'));
                  return;
                }
                onModelClick?.();
              }}
              aria-label={`${text.modelLabel}: ${context.modelLabel}`}
              {...(renderModelMenu
                ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': openMenu === 'model' }
                : {})}
            >
              {modelChipBody}
            </button>
          ) : (
            <span className={styles.chip} title={`${text.modelLabel}: ${context.modelLabel}`}>
              {modelChipBody}
            </span>
          )}
          {renderModelMenu && openMenu === 'model' ? (
            <div className={styles.menu}>{renderModelMenu({ close: () => setOpenMenu(null) })}</div>
          ) : null}
        </div>

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
