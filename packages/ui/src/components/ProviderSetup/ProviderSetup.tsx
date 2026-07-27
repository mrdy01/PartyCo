import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Icon } from '@partyco/icons';
import { KEY_GUARANTEE_STORAGE } from '../AppShell/model.ts';
import { Badge } from '../Badge/Badge.tsx';
import { Button } from '../Button/Button.tsx';
import { CredentialGuarantee } from '../CredentialGuarantee/CredentialGuarantee.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { Input } from '../Input/Input.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import { ProviderGlyph } from '../ProviderGlyph/ProviderGlyph.tsx';
import s from './ProviderSetup.module.css';

/* ------------------------------------------------------------------ model */

/**
 * The two ways a member can reach a model, named exactly as the agent layer names them
 * (`AuthMode` in `packages/agents/src/env.ts`): a key we were given, or a CLI the member installed
 * and signed into themselves.
 */
export type ProviderMode = 'api-key' | 'subscription';

/**
 * The vendor's own position on a transport, mirroring `PolicyStatus` in
 * `packages/agents/src/policy.ts`.
 *
 * Restated here rather than imported because `@partyco/ui` depends on tokens and icons and nothing
 * else — a component package that reaches into the daemon's package is how a UI ends up unable to
 * render in a storybook. The vocabulary is small and stable; the *catalogue* stays over there, and
 * arrives here through props (convention §8).
 */
export type ProviderPolicyStatus =
  | 'documented-allowed'
  | 'documented-embedding'
  | 'tolerated-undocumented'
  | 'requires-approval'
  | 'prohibited';

/**
 * Whether a member may switch to a transport at all. Same table as `POLICY_SELECTABLE`.
 *
 * A refused transport is still **drawn** — see `ProviderSetup` — because an option missing without
 * explanation teaches nothing, while a disabled option carrying the vendor's own sentence teaches
 * a person not to look for a workaround.
 */
export const PROVIDER_POLICY_SELECTABLE: Record<ProviderPolicyStatus, boolean> = {
  'documented-allowed': true,
  'documented-embedding': true,
  'tolerated-undocumented': true,
  'requires-approval': false,
  prohibited: false,
};

/** How the status reads on the badge. Never invented per-provider — the status is the claim. */
export const PROVIDER_POLICY_LABEL: Record<ProviderPolicyStatus, string> = {
  'documented-allowed': 'Вендор написал: используйте так',
  'documented-embedding': 'Вендор описал встраивание',
  'tolerated-undocumented': 'Вендор не разрешал и не запрещал',
  'requires-approval': 'Нужно разрешение вендора',
  prohibited: 'Вендор запрещает',
};

/**
 * Status colour of the badge. `tolerated-undocumented` is amber on purpose: it is an observation
 * about what survived enforcement, not a permission, and it must not look like one.
 */
export const PROVIDER_POLICY_TONE: Record<ProviderPolicyStatus, 'success' | 'warning' | 'danger'> = {
  'documented-allowed': 'success',
  'documented-embedding': 'success',
  'tolerated-undocumented': 'warning',
  'requires-approval': 'warning',
  prohibited: 'danger',
};

/** One transport of one provider, as the policy catalogue describes it. */
export interface ProviderTransportInfo {
  status: ProviderPolicyStatus;
  /** One sentence a person can act on. Shown verbatim — a refusal nobody can read is a bug report. */
  summary: string;
  /** Where the vendor said it. Claims carry their source, so it is rendered, not hidden. */
  source?: string | undefined;
  /** A vendor-announced change that will end this transport. Anthropic's CLI path has one. */
  expiry?: string | undefined;
}

/**
 * What the detector found out about the member's CLI.
 *
 * The whole of it: a binary name, whether it is on `PATH`, and what `--version` printed. There is
 * deliberately no "signed in" field, because finding that out would mean reading the vendor's
 * credential file, and no code path in this product does that. Whether the member is signed in is
 * answered by the first run of the tool and by nothing before it.
 */
export interface ProviderCliDetection {
  /** Executable name resolved on `PATH`, e.g. `claude`. */
  binary: string;
  /** `true` — found; `false` — looked and did not find; omitted — not looked yet. */
  found?: boolean | undefined;
  /** Whatever `--version` printed. Absent when the binary answered nothing recognisable. */
  version?: string | undefined;
  /** How to install it, e.g. `npm i -g @anthropic-ai/claude-code`. */
  installHint?: string | undefined;
}

/**
 * One provider as this panel needs it.
 *
 * **No secret is in this shape and none ever will be.** `hasKey` is a fact about the keychain, not
 * the key: whether a key exists is something a person needs to see, and the key itself is something
 * this component must never be able to render, log or leak — so it does not arrive.
 */
export interface ProviderSetupItem {
  id: string;
  label: string;
  /** One letter for the square, e.g. `A`. Falls back to the first letter of `label`. */
  glyph?: string | undefined;
  /** Shape of the key, shown as a placeholder so a wrong-vendor paste is obvious before submit. */
  apiKeyHint: string;
  /** Variable the key is handed to the child process in, e.g. `ANTHROPIC_API_KEY`. */
  apiKeyEnv?: string | undefined;
  /** The `direct-api` transport. Every provider has one — it is the documented path. */
  apiKey: ProviderTransportInfo;
  /** The `local-agent-cli` transport. Absent when the vendor offers no CLI path at all. */
  cli?: ProviderTransportInfo | undefined;
  /** What the detector found. Meaningful only alongside `cli`. */
  detection?: ProviderCliDetection | undefined;
  /** Whether a key for this provider is already in the keychain. Never the key. */
  hasKey?: boolean | undefined;
  /** The chosen mode, when the caller owns the choice. Omit and the panel keeps it. */
  mode?: ProviderMode | undefined;
}

/* ------------------------------------------------------------------- copy */

export interface ProviderSetupCopy {
  /** Accessible name of the whole panel. */
  region: string;
  heading: string;
  intro: string;
  /** `<legend>` of the mode group. */
  modeGroup: string;
  modeApiKey: string;
  modeApiKeyNote: string;
  modeCli: string;
  modeCliNote: string;
  /** Right-hand fact on the key row. */
  keyPresentShort: string;
  keyAbsentShort: string;
  /** Right-hand fact on the CLI row. */
  detectShortFound: string;
  detectShortMissing: string;
  detectShortUnknown: string;
  keyField: string;
  keySave: string;
  keyReplace: string;
  keySaving: string;
  keyNeverShown: string;
  /** `{env}` is replaced with the variable name. */
  keyEnv: string;
  keyPresent: string;
  keyAbsent: string;
  /** The sentence that makes the delegated mode honest. Shown whenever that mode is chosen. */
  cliDelegation: string;
  /** `{binary}` is replaced. The one thing we cannot know and say so. */
  cliAuthUnknown: string;
  /** `{binary}` and `{version}` are replaced. */
  detectFound: string;
  detectFoundBare: string;
  detectMissing: string;
  detectUnknown: string;
  /** `{hint}` is replaced with the install command. */
  installHint: string;
  installBare: string;
  redetect: string;
  expiryTitle: string;
  sourceLabel: string;
  emptyTitle: string;
  emptyBody: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  /** Name of the OS credential store, for the guarantee at the bottom. */
  storeName: string;
  /** Where a key goes the moment it is submitted. Same sentence the first-run step makes. */
  guaranteeNote: string;
}

export const PROVIDER_SETUP_COPY: ProviderSetupCopy = {
  region: 'Провайдеры',
  heading: 'Как PartyCo обращается к модели',
  intro:
    'Два пути, и оба начинаются на твоей машине: ключ, который ты дал сам, или инструмент, ' +
    'который ты сам поставил и в который сам вошёл. Третьего — своего входа в чужую подписку — ' +
    'здесь нет и не будет.',
  modeGroup: 'Режим работы',
  modeApiKey: 'По ключу',
  modeApiKeyNote: 'Ключ провайдера, оплата по токенам, работает без установленного CLI.',
  modeCli: 'Через установленный CLI',
  modeCliNote: 'Твоя подписка, твой вход, твой компьютер.',
  keyPresentShort: 'ключ задан',
  keyAbsentShort: 'ключа нет',
  detectShortFound: 'найден',
  detectShortMissing: 'не найден',
  detectShortUnknown: 'не проверяли',
  keyField: 'Ключ',
  keySave: 'Сохранить ключ',
  keyReplace: 'Заменить ключ',
  keySaving: 'Сохраняем…',
  keyNeverShown: 'Сам ключ не показывается — ни здесь, ни на других экранах.',
  keyEnv:
    'Ключ попадает в {env} того процесса, который ты запустил, и никуда больше: окружение ' +
    'собирается по списку, а не наследуется.',
  keyPresent: 'Ключ уже задан',
  keyAbsent: 'Ключа пока нет',
  cliDelegation:
    'Запускаем инструмент, который ты уже установил и в который сам вошёл. PartyCo не видит твой ' +
    'логин, не хранит его и не делает запросов к провайдеру — их делает сам инструмент.',
  cliAuthUnknown:
    'Вошёл ли ты в {binary} — мы не знаем и узнать не можем: файлы с логином PartyCo не читает. ' +
    'Если не вошёл, об этом скажет первый же запуск.',
  detectFound: 'Найден: {binary} {version}',
  detectFoundBare: 'Найден: {binary}. Версию узнать не удалось.',
  detectMissing: '{binary} не найден в PATH.',
  detectUnknown: '{binary} ещё не искали.',
  installHint: 'Поставить: {hint}. После установки войди в него сам — PartyCo этого не делает.',
  installBare:
    'Поставь официальный CLI провайдера и войди в него сам — PartyCo этого за тебя не делает.',
  redetect: 'Проверить снова',
  expiryTitle: 'У режима есть срок годности',
  sourceLabel: 'Источник:',
  emptyTitle: 'Провайдеров пока нет',
  emptyBody: 'Список приходит из каталога. Пока он пуст, обращаться к модели не через что.',
  loading: 'Читаем каталог провайдеров',
  errorTitle: 'Не удалось прочитать список провайдеров',
  errorBody: 'Ключи и вход в CLI при этом не тронуты — прочитать список заново безопасно.',
  retry: 'Повторить',
  /*
   * The real name of the store, so the sentence under it («ляжет в хранилище Windows, рядом с
   * паролями браузера») and the sentence above it agree. Windows-first is the product's own stance
   * — see §5.1 of the legality note — and this is a copy prop, so another platform overrides it.
   */
  storeName: 'Windows Credential Manager',
  guaranteeNote: KEY_GUARANTEE_STORAGE,
};

/**
 * Flat on purpose. `FirstRun` nests its overrides because a flat `Partial` there would let a caller
 * changing one word wipe a whole block; here there are no blocks to wipe, so a flat merge is both
 * safe and easier to call.
 */
export type ProviderSetupCopyInput = Partial<ProviderSetupCopy>;

/* ------------------------------------------------------------------ props */

/** Convention §6: the three states are declared, not deferred. */
export type ProviderSetupState = 'ready' | 'loading' | 'error';

export interface ProviderSetupProps {
  /** The catalogue, already resolved by the caller. This panel knows nothing about where it lives. */
  providers: readonly ProviderSetupItem[];
  /** A mode was chosen. A refused transport can never be the argument — the panel filters it out. */
  onModeChange?: ((providerId: string, mode: ProviderMode) => void) | undefined;
  /**
   * A key was submitted. The value passes through this call once and is dropped from the panel's
   * own state immediately afterwards; storing it is the caller's business and its risk.
   * Omit and no key field is drawn at all — a field that cannot save is a dead control.
   */
  onKeySubmit?: ((providerId: string, key: string) => void) | undefined;
  /** Re-run binary detection for every provider. Omit and the button disappears. */
  onRedetect?: (() => void) | undefined;
  /** Which provider's key is being stored right now. Its submit spins and stops taking clicks. */
  busyProviderId?: string | null | undefined;
  state?: ProviderSetupState | undefined;
  onRetry?: (() => void) | undefined;
  /**
   * How many secrets the keychain holds, for the guarantee at the bottom. Defaults to the number of
   * providers reporting `hasKey`, which is what this panel can actually see.
   */
  keysStored?: number | undefined;
  /** Opens the OS keychain. Omit and the guarantee has no button. */
  onOpenStore?: (() => void) | undefined;
  copy?: ProviderSetupCopyInput | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------- fragments */

interface PolicyNoteProps {
  info: ProviderTransportInfo;
  sourceLabel: string;
}

/**
 * The vendor's position on one transport: a status pill, the vendor's own sentence, and where they
 * said it. Status colour appears as a pill and as nothing else (convention §5).
 */
function PolicyNote({ info, sourceLabel }: PolicyNoteProps): ReactElement {
  return (
    <div className={s.policy}>
      <Badge status={PROVIDER_POLICY_TONE[info.status]} className={s.policyBadge}>
        {PROVIDER_POLICY_LABEL[info.status]}
      </Badge>
      <p className={s.policyText}>{info.summary}</p>
      {info.source ? (
        <p className={s.source}>
          <span className={s.sourceLabel}>{sourceLabel}</span>{' '}
          <span className={s.sourceValue}>{info.source}</span>
        </p>
      ) : null}
    </div>
  );
}

/** `found` / `missing` / `unknown` — the only three answers "is the binary there" has. */
type DetectState = 'found' | 'missing' | 'unknown';

function detectStateOf(detection: ProviderCliDetection | undefined): DetectState {
  if (!detection || detection.found === undefined) return 'unknown';
  return detection.found ? 'found' : 'missing';
}

function detectLine(
  detection: ProviderCliDetection | undefined,
  state: DetectState,
  t: ProviderSetupCopy,
): string {
  const binary = detection?.binary ?? '';
  if (state === 'found') {
    const version = detection?.version;
    return version
      ? t.detectFound.replace('{binary}', binary).replace('{version}', version)
      : t.detectFoundBare.replace('{binary}', binary);
  }
  if (state === 'missing') return t.detectMissing.replace('{binary}', binary);
  return t.detectUnknown.replace('{binary}', binary);
}

/* -------------------------------------------------------------- component */

/**
 * «Провайдеры» — where a member chooses how their agent reaches a model.
 *
 * The panel exists because the choice is not a preference, it is a legal and a billing decision, and
 * both halves have to be stated where the switch is thrown:
 *
 * - **По ключу** — the documented path. The field is a password by nature and treated as one:
 *   `type="password"`, autocomplete and spellcheck off, the value leaving through `onKeySubmit`
 *   once and being dropped from state straight after. The key never arrives as a prop, so «ключ
 *   задан» is rendered from `hasKey` — a fact about the keychain — and the key itself is a thing
 *   this component is structurally incapable of showing.
 * - **Через установленный CLI** — the delegated path, and the only subscription path that survived
 *   the 2026 enforcement rounds (`docs/providers-and-subscription-legality.md` §1, §5.1). It comes
 *   with a sentence, not a checkbox, because what it does is unusual enough that a person deserves
 *   to be told: we spawn a binary they installed and signed into, we do not see their login, and we
 *   make no request to the vendor ourselves.
 *
 * Two consequences of that honesty are visible in the markup. First, "signed in" is never claimed:
 * knowing it would require reading the vendor's credential file, which no code path here does, so
 * the panel says plainly that the first run is what will find out. Second, a transport the vendor
 * forbids is **drawn disabled with the vendor's own sentence under it** rather than omitted —
 * Google's CLI path is refused, and a person who cannot see why will go looking for a workaround.
 */
export function ProviderSetup({
  providers,
  onModeChange,
  onKeySubmit,
  onRedetect,
  busyProviderId,
  state = 'ready',
  onRetry,
  keysStored,
  onOpenStore,
  copy,
  className,
}: ProviderSetupProps): ReactElement {
  const t: ProviderSetupCopy = copy ? { ...PROVIDER_SETUP_COPY, ...copy } : PROVIDER_SETUP_COPY;

  const autoId = useId();
  const domId = (providerId: string, part: string): string =>
    `pc-provider-setup-${autoId}-${providerId}-${part}`;

  /** Mode picks the caller did not take over. Keyed by provider id. */
  const [modePicks, setModePicks] = useState<Record<string, ProviderMode>>({});
  /**
   * Key drafts, while they are being typed. The one place a key lives in this component, and it is
   * emptied the moment the key is handed over.
   */
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});

  function cliSelectable(item: ProviderSetupItem): boolean {
    return item.cli !== undefined && PROVIDER_POLICY_SELECTABLE[item.cli.status];
  }

  /**
   * The key path is checked against the catalogue too, not assumed open.
   *
   * Today every provider's `direct-api` is `documented-allowed`, so this is always true — which is
   * precisely why it has to be written down. The refusal machinery below used to run on the CLI row
   * alone, and a vendor moving their key path to `requires-approval` would have left this panel
   * drawing an enabled field for a transport the same catalogue forbids.
   */
  function keySelectable(item: ProviderSetupItem): boolean {
    return PROVIDER_POLICY_SELECTABLE[item.apiKey.status];
  }

  function selectableOf(item: ProviderSetupItem, mode: ProviderMode): boolean {
    return mode === 'api-key' ? keySelectable(item) : cliSelectable(item);
  }

  /**
   * A refused transport is never the effective mode, whatever the caller passed or the panel
   * remembers. The refusal is enforced here as well as in the daemon, because a UI that renders the
   * body of a forbidden mode is a UI that eventually offers a button to run it.
   *
   * When both are refused the key body still wins — the member sees the vendor's sentence and no
   * control, which is the only honest thing left to draw.
   */
  function modeOf(item: ProviderSetupItem): ProviderMode {
    const asked = item.mode ?? modePicks[item.id] ?? 'api-key';
    if (selectableOf(item, asked)) return asked;
    const other: ProviderMode = asked === 'api-key' ? 'subscription' : 'api-key';
    return selectableOf(item, other) ? other : 'api-key';
  }

  function selectMode(item: ProviderSetupItem, next: ProviderMode): void {
    if (!selectableOf(item, next)) return;
    if (next === modeOf(item)) return;
    if (item.mode === undefined) setModePicks((prev) => ({ ...prev, [item.id]: next }));
    onModeChange?.(item.id, next);
  }

  function changeKey(providerId: string, next: string): void {
    setKeyDrafts((prev) => ({ ...prev, [providerId]: next }));
  }

  function submitKey(event: FormEvent<HTMLFormElement>, item: ProviderSetupItem): void {
    event.preventDefault();
    // Trimmed once, here: a pasted key carries a stray newline far more often than a meaningful
    // edge space.
    const value = (keyDrafts[item.id] ?? '').trim();
    if (value === '' || busyProviderId === item.id) return;
    onKeySubmit?.(item.id, value);
    // Handed over, so gone. The caller owns it from this line on.
    setKeyDrafts((prev) => ({ ...prev, [item.id]: '' }));
  }

  /* ---------------------------------------------------------- one provider */

  function renderKeyBlock(item: ProviderSetupItem): ReactElement {
    const draft = keyDrafts[item.id] ?? '';
    const busy = busyProviderId === item.id;

    return (
      <div className={s.detail}>
        <PolicyNote info={item.apiKey} sourceLabel={t.sourceLabel} />

        <p className={s.fact} data-tone={item.hasKey ? 'success' : undefined}>
          <Icon name={item.hasKey ? 'keychain' : 'key'} className={s.factGlyph} />
          <span className={s.factText}>{item.hasKey ? t.keyPresent : t.keyAbsent}</span>
        </p>

        {/*
         * No field for a transport the catalogue refuses: the policy note above already carries the
         * vendor's sentence, and a box to paste a key into is an invitation to use the thing that
         * was just refused.
         */}
        {onKeySubmit && keySelectable(item) ? (
          <form
            className={s.keyForm}
            noValidate
            aria-label={`${t.keyField} · ${item.label}`}
            aria-busy={busy || undefined}
            onSubmit={(event) => submitKey(event, item)}
          >
            <Input
              className={s.keyField}
              label={t.keyField}
              type="password"
              name={`provider-key-${item.id}`}
              mono
              /* A provider key is not a login: no manager should offer to fill or keep it. */
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={item.apiKeyHint}
              value={draft}
              hint={t.keyNeverShown}
              onChange={(event) => changeKey(item.id, event.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              className={s.keySave}
              loading={busy}
              loadingLabel={t.keySaving}
              disabled={draft.trim() === ''}
            >
              {item.hasKey ? t.keyReplace : t.keySave}
            </Button>
          </form>
        ) : null}

        {item.apiKeyEnv ? (
          <p className={s.note}>{t.keyEnv.replace('{env}', item.apiKeyEnv)}</p>
        ) : null}
      </div>
    );
  }

  function renderCliBlock(item: ProviderSetupItem, cli: ProviderTransportInfo): ReactElement {
    const detectState = detectStateOf(item.detection);
    const binary = item.detection?.binary ?? '';
    const installHint = item.detection?.installHint;

    return (
      <div className={s.detail}>
        <PolicyNote info={cli} sourceLabel={t.sourceLabel} />

        {/* The sentence the mode is sold on. Not fine print — this is what the switch means. */}
        <p className={s.delegation}>{t.cliDelegation}</p>

        <div className={s.detect}>
          <span className={s.dot} data-tone={detectState} aria-hidden="true" />
          <span className={s.detectText}>{detectLine(item.detection, detectState, t)}</span>
          {onRedetect ? (
            <Button variant="ghost" size="sm" className={s.redetect} onClick={onRedetect}>
              {t.redetect}
            </Button>
          ) : null}
        </div>

        {detectState === 'missing' ? (
          <p className={s.note}>
            {installHint ? t.installHint.replace('{hint}', installHint) : t.installBare}
          </p>
        ) : null}

        {/*
         * The honest line. Being signed in is the one thing detection cannot answer, because
         * answering it would mean reading the vendor's credential file — and nothing here does.
         */}
        <p className={s.honest}>
          <Icon name="info" className={s.honestGlyph} />
          <span className={s.honestText}>{t.cliAuthUnknown.replace('{binary}', binary)}</span>
        </p>

        {cli.expiry ? (
          <div className={s.expiry}>
            <Icon name="clock" className={s.expiryGlyph} />
            <span className={s.expiryText}>
              <span className={s.expiryTitle}>{t.expiryTitle}</span>
              <span className={s.expiryBody}>{cli.expiry}</span>
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  function renderModeRow(
    item: ProviderSetupItem,
    mode: ProviderMode,
    active: boolean,
  ): ReactElement {
    const isKey = mode === 'api-key';
    /** The catalogue entry this row is about — one of the two is always the one being refused. */
    const info: ProviderTransportInfo | undefined = isKey ? item.apiKey : item.cli;
    const allowed = selectableOf(item, mode);
    const titleId = domId(item.id, `${mode}-title`);
    const noteId = domId(item.id, `${mode}-note`);
    const reasonId = domId(item.id, `${mode}-reason`);
    const refused = !allowed && info !== undefined;

    const detectState = detectStateOf(item.detection);
    const shortFact = isKey
      ? item.hasKey
        ? t.keyPresentShort
        : t.keyAbsentShort
      : detectState === 'found'
        ? t.detectShortFound
        : detectState === 'missing'
          ? t.detectShortMissing
          : t.detectShortUnknown;
    const factTone = isKey
      ? item.hasKey
        ? 'success'
        : undefined
      : detectState === 'found'
        ? 'success'
        : detectState === 'missing'
          ? 'warning'
          : undefined;

    return (
      <div className={s.modeCell}>
        <label
          className={s.modeRow}
          data-selected={active || undefined}
          data-disabled={!allowed || undefined}
        >
          <input
            type="radio"
            className={s.modeInput}
            name={domId(item.id, 'mode')}
            value={mode}
            checked={active}
            disabled={!allowed}
            aria-labelledby={titleId}
            aria-describedby={refused ? `${noteId} ${reasonId}` : noteId}
            onChange={() => selectMode(item, mode)}
          />
          <span className={s.radio} aria-hidden="true">
            <span className={s.radioDot} />
          </span>
          <span className={s.modeText}>
            <span className={s.modeTitle} id={titleId}>
              {isKey ? t.modeApiKey : t.modeCli}
            </span>
            <span className={s.modeNote} id={noteId}>
              {isKey ? t.modeApiKeyNote : t.modeCliNote}
            </span>
          </span>
          {refused && info ? (
            <Badge status={PROVIDER_POLICY_TONE[info.status]} className={s.modeBadge}>
              {PROVIDER_POLICY_LABEL[info.status]}
            </Badge>
          ) : (
            <span className={s.modeFact} data-tone={factTone}>
              {shortFact}
            </span>
          )}
        </label>

        {/*
         * A forbidden transport keeps its reason in the open. Hiding the option would leave a person
         * guessing why the list is short; the vendor's own sentence, with the URL it came from,
         * ends the search instead of starting one.
         */}
        {refused && info ? (
          <p className={s.refusal} id={reasonId}>
            <Icon name="incident" className={s.refusalGlyph} />
            <span className={s.refusalText}>
              {info.summary}
              {info.source ? (
                <>
                  {' '}
                  <span className={s.sourceLabel}>{t.sourceLabel}</span>{' '}
                  <span className={s.sourceValue}>{info.source}</span>
                </>
              ) : null}
            </span>
          </p>
        ) : null}
      </div>
    );
  }

  function renderProvider(item: ProviderSetupItem): ReactElement {
    const mode = modeOf(item);
    const titleId = domId(item.id, 'title');
    const cli = item.cli;

    return (
      <li className={s.item} key={item.id}>
        <section className={s.card} aria-labelledby={titleId}>
          <h3 className={s.cardTitle} id={titleId}>
            <ProviderGlyph
              providerId={item.id}
              label={item.label}
              letter={item.glyph}
              className={s.chip}
            />
          </h3>

          {/*
           * Only when there is a choice to make. A provider with no CLI path gets the key form
           * directly rather than a group of one, which would look like a setting rather than a fact.
           */}
          {cli ? (
            <fieldset className={s.fieldset}>
              <legend className={s.legend}>{t.modeGroup}</legend>
              <div className={s.modeList}>
                {renderModeRow(item, 'api-key', mode === 'api-key')}
                {renderModeRow(item, 'subscription', mode === 'subscription')}
              </div>
            </fieldset>
          ) : null}

          {mode === 'subscription' && cli ? renderCliBlock(item, cli) : renderKeyBlock(item)}
        </section>
      </li>
    );
  }

  /* ------------------------------------------------------------------ body */

  let body: ReactElement;

  if (state === 'loading') {
    body = (
      <div className={s.stateBlock}>
        <LoadingState rows={3} caption={t.loading} label={t.loading} />
      </div>
    );
  } else if (state === 'error') {
    body = (
      <div className={s.stateBlock}>
        <ErrorState
          title={t.errorTitle}
          description={t.errorBody}
          {...(onRetry ? { onRetry } : {})}
          retryLabel={t.retry}
        />
      </div>
    );
  } else if (providers.length === 0) {
    body = (
      <div className={s.stateBlock}>
        <EmptyState icon="provider" title={t.emptyTitle} description={t.emptyBody} />
      </div>
    );
  } else {
    body = (
      <ul className={s.list}>{providers.map((item) => renderProvider(item))}</ul>
    );
  }

  /*
   * The counter is a claim, so it is only made when the list behind it is real. While the catalogue
   * is still being read — or after it failed — «0 ключей в хранилище» would be a statement the
   * panel cannot back up, exactly as with the head count in `TeamPanel`.
   */
  const guarantee =
    state === 'ready' ? (
      <CredentialGuarantee
        className={s.guarantee}
        storeName={t.storeName}
        keysStored={keysStored ?? providers.filter((item) => item.hasKey).length}
        sentToHub={0}
        verifyNote={t.guaranteeNote}
        {...(onOpenStore ? { onOpenStore } : {})}
      />
    ) : null;

  return (
    <section className={cx(s.panel, className)} aria-label={t.region}>
      <header className={s.header}>
        <h2 className={s.heading}>{t.heading}</h2>
        <p className={s.intro}>{t.intro}</p>
      </header>
      <div className={s.body}>{body}</div>
      {guarantee}
    </section>
  );
}
