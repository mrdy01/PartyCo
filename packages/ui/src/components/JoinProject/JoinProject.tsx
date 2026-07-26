import {
  Fragment,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_GROUPS,
  INVITE_CODE_GROUP_SIZE,
  type ProjectMember,
} from '../AppShell/model.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { AvatarStack } from '../AvatarStack/AvatarStack.tsx';
import { Button } from '../Button/Button.tsx';
import s from './JoinProject.module.css';

/* ----------------------------------------------------------------- labels */

export interface JoinProjectLabels {
  /* entering a code */
  title: string;
  body: ReactNode;
  submit: string;
  joining: string;
  /** Accessible name of the whole code field. */
  codeGroup: string;
  /** Accessible name of one group. `{n}` is replaced by the group's 1-based number. */
  codeGroupItem: string;
  /** The character drawn between groups. Decorative — hidden from assistive tech. */
  separator: string;
  /** Accessible name of the failure glyph. */
  errorLabel: string;

  /* already in */
  /** `{project}` is replaced by the project's name. */
  joinedTitle: string;
  joinedBody: ReactNode;
  open: string;
  footnote: ReactNode;
  /** Accessible name of the presence stack. */
  presenceGroup: string;
}

export const JOIN_PROJECT_LABELS: JoinProjectLabels = {
  title: 'Введи код, который тебе дали',
  body: 'Если пришла ссылка — можно просто открыть её, поле заполнится само.',
  submit: 'Присоединиться',
  joining: 'Проверяем код',
  codeGroup: 'Код приглашения',
  codeGroupItem: 'Часть кода {n}',
  separator: '—',
  errorLabel: 'Ошибка',

  joinedTitle: 'Ты в проекте «{project}»',
  joinedBody:
    'Зоны за тебя никто не занимал — возьмёшь ту, в которой начнёшь работать. Если она уже чья-то, скажу об этом до того, как агент что-то тронет.',
  open: 'Открыть разговор',
  footnote:
    'Ключ провайдера у тебя ещё не спрашивали — спросим, когда ты первый раз попросишь агента что-то сделать.',
  presenceGroup: 'Кто сейчас в проекте',
};

export type JoinProjectLabelsInput = Partial<JoinProjectLabels>;

function mergeLabels(input?: JoinProjectLabelsInput): JoinProjectLabels {
  if (!input) return JOIN_PROJECT_LABELS;
  return { ...JOIN_PROJECT_LABELS, ...input };
}

/* -------------------------------------------------------------- code maths */

const CODE_LENGTH = INVITE_CODE_GROUPS * INVITE_CODE_GROUP_SIZE;
const SEPARATOR = '-';
const ALPHABET = new Set(INVITE_CODE_ALPHABET.split(''));

/**
 * Everything a person could plausibly paste, reduced to what a code may contain.
 *
 * Case is folded up before the alphabet check, so a lower-case `htal` typed by hand survives while
 * the look-alikes the alphabet deliberately omits (`O`, `0`, `I`, `l`, `1`) are dropped rather than
 * silently accepted into a code that can never match.
 */
function normalizeCode(raw: string, limit = CODE_LENGTH): string {
  let out = '';
  for (const char of raw.toUpperCase()) {
    if (!ALPHABET.has(char)) continue;
    out += char;
    if (out.length === limit) break;
  }
  return out;
}

/**
 * Splits a code into its groups **by position**.
 *
 * A string that already carries the separators is trusted group-for-group; anything else — a code
 * read off a link, a code dictated over the phone — is chunked. The distinction matters because a
 * person may empty the middle group while fixing a typo: chunking alone would slide the third group
 * left into the hole and quietly rewrite a code the person is still looking at.
 */
function toGroups(raw: string): string[] {
  const parts = raw.split(SEPARATOR);
  if (parts.length === INVITE_CODE_GROUPS) {
    return parts.map((part) => normalizeCode(part, INVITE_CODE_GROUP_SIZE));
  }
  const flat = normalizeCode(raw);
  const groups: string[] = [];
  for (let i = 0; i < INVITE_CODE_GROUPS; i += 1) {
    groups.push(flat.slice(i * INVITE_CODE_GROUP_SIZE, (i + 1) * INVITE_CODE_GROUP_SIZE));
  }
  return groups;
}

/**
 * `HTAK-4K7M-9ZQD` when the code is complete, `HTAK-4K` while it is being typed.
 *
 * Trailing separators are noise while a code is half-typed — but only while every group before the
 * last one typed in is **full**. That is exactly the condition under which `toGroups` may re-chunk
 * the string and still land on the same boxes. The moment it does not hold — a person clicked
 * straight into the second box, or came back to fix a short first group — the separators are
 * load-bearing and every one of them is kept, so `toGroups` takes the positional branch instead.
 *
 * Dropping them unconditionally moved the person's own characters while they were looking at them:
 * `['', '4K7M', '']` became `-4K7M`, which chunks back to `['4K7M', '', '']`.
 */
function formatCode(groups: readonly string[]): string {
  const joined = groups.join(SEPARATOR);

  let lastFilled = -1;
  groups.forEach((group, index) => {
    if (group.length > 0) lastFilled = index;
  });
  const dense =
    lastFilled <= 0 || groups.slice(0, lastFilled).every((g) => g.length === INVITE_CODE_GROUP_SIZE);
  if (!dense) return joined;

  let end = joined.length;
  while (end > 0 && joined[end - 1] === SEPARATOR) end -= 1;
  return joined.slice(0, end);
}

/* ------------------------------------------------------------------ props */

/** Two moments of the same screen: before the code is accepted, and right after. */
export type JoinProjectState = 'code' | 'joined';

export interface JoinProjectProps {
  state?: JoinProjectState | undefined;

  /* ---- state: code ---- */
  /** Controlled value. Anything outside the code alphabet is dropped on the way in. */
  value?: string | undefined;
  /** Starting value for the uncontrolled case — e.g. a code lifted out of the opened link. */
  defaultValue?: string | undefined;
  /** Fires on every keystroke with the `HTAK-4K7M` form of what has been typed so far. */
  onCodeChange?: ((code: string) => void) | undefined;
  /** Fires with the complete `HTAK-4K7M-9ZQD`. */
  onSubmit?: ((code: string) => void) | undefined;
  /** The code is with the hub: the button spins and the fields stay readable. */
  joining?: boolean | undefined;
  /** Why the code did not work, in the person's words. Renders the failure plaque. */
  error?: string | undefined;

  /* ---- state: joined ---- */
  /** The person who just joined — their avatar and their colour. */
  member?: ProjectMember | undefined;
  projectName?: string | undefined;
  /**
   * The colour sentence («Твой цвет — индиго…»). No default: the colour's name comes from data,
   * and a wrong colour word here would be the first thing the new person reads.
   */
  colourNote?: ReactNode;
  /** Who is already in the project. Empty and the presence plaque is not drawn. */
  present?: readonly ProjectMember[] | undefined;
  /** What the presence plaque says next to the avatars. */
  presenceNote?: ReactNode;
  onOpenConversation?: (() => void) | undefined;

  identitySet?: IdentitySetName | undefined;
  labels?: JoinProjectLabelsInput | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ panel */

/**
 * What the invited person sees — the code field, and the moment after it worked.
 *
 * One component and not two, because the second frame is the answer to the first: the same surface,
 * the same width, the same footnote position. Splitting them would let the "you're in" screen drift
 * away from the screen that leads to it.
 *
 * The field never hard-codes three groups of four. `INVITE_CODE_GROUPS`, `INVITE_CODE_GROUP_SIZE`
 * and `INVITE_CODE_ALPHABET` come from model.ts, which is checked against `apps/hub/src/invites.js`
 * by the hub's own tests — so the day the code shape changes, this field changes with it.
 */
export function JoinProject({
  state = 'code',
  value,
  defaultValue = '',
  onCodeChange,
  onSubmit,
  joining = false,
  error,
  member,
  projectName,
  colourNote,
  present,
  presenceNote,
  onOpenConversation,
  identitySet,
  labels,
  className,
}: JoinProjectProps): ReactElement {
  const copy = mergeLabels(labels);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [selfGroups, setSelfGroups] = useState<string[]>(() => toGroups(defaultValue));
  const fromValue = useMemo(() => (value === undefined ? null : toGroups(value)), [value]);
  const groups = fromValue ?? selfGroups;
  const complete = groups.every((group) => group.length === INVITE_CODE_GROUP_SIZE);

  const focusGroup = useCallback((index: number): void => {
    const at = Math.min(Math.max(index, 0), INVITE_CODE_GROUPS - 1);
    const node = inputs.current[at];
    if (!node) return;
    node.focus();
    node.select();
  }, []);

  /**
   * Writes `text` starting at group `from`, spilling into the groups after it. One rule covers
   * typing (one character), pasting a whole code, and pasting a fragment into the middle.
   */
  const write = useCallback(
    (from: number, text: string): void => {
      const next = [...groups];
      next[from] = text.slice(0, INVITE_CODE_GROUP_SIZE);
      let rest = text.slice(INVITE_CODE_GROUP_SIZE);
      let last = from;
      for (let g = from + 1; g < INVITE_CODE_GROUPS && rest.length > 0; g += 1) {
        next[g] = rest.slice(0, INVITE_CODE_GROUP_SIZE);
        rest = rest.slice(INVITE_CODE_GROUP_SIZE);
        last = g;
      }

      if (value === undefined) setSelfGroups(next);
      onCodeChange?.(formatCode(next));

      // Move on only once the group the person is standing in is actually full.
      const landed = next[last] ?? '';
      if (landed.length === INVITE_CODE_GROUP_SIZE && last < INVITE_CODE_GROUPS - 1) {
        focusGroup(last + 1);
      }
    },
    [focusGroup, groups, onCodeChange, value],
  );

  /**
   * Backspace on an empty group steps back a box; the arrows cross a boundary only when the caret
   * is already sitting on it, so moving inside a four-character group still works the way every
   * other text field in the product works.
   */
  const handleKeyDown = useCallback(
    (index: number) => (event: KeyboardEvent<HTMLInputElement>): void => {
      const field = event.currentTarget;
      const current = groups[index] ?? '';
      const start = field.selectionStart ?? current.length;
      const end = field.selectionEnd ?? current.length;

      if (event.key === 'Backspace' && current.length === 0 && index > 0) {
        event.preventDefault();
        focusGroup(index - 1);
        return;
      }
      if (event.key === 'ArrowLeft' && index > 0 && start === 0 && end === 0) {
        event.preventDefault();
        focusGroup(index - 1);
        return;
      }
      if (
        event.key === 'ArrowRight' &&
        index < INVITE_CODE_GROUPS - 1 &&
        start === current.length &&
        end === current.length
      ) {
        event.preventDefault();
        focusGroup(index + 1);
      }
    },
    [focusGroup, groups],
  );

  const handlePaste = useCallback(
    (index: number) => (event: ClipboardEvent<HTMLInputElement>): void => {
      const pasted = normalizeCode(event.clipboardData.getData('text'));
      if (pasted.length === 0) return;
      event.preventDefault();
      // A whole code lands at the beginning wherever it was dropped; a fragment stays put.
      write(pasted.length >= CODE_LENGTH ? 0 : index, pasted);
    },
    [write],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!complete || joining) return;
      onSubmit?.(formatCode(groups));
    },
    [complete, groups, joining, onSubmit],
  );

  if (state === 'joined') {
    const title = copy.joinedTitle.replace('{project}', projectName ?? '');
    const people = present ?? [];
    return (
      <section className={cx(s.card, className)} aria-label={title}>
        <div className={s.identity}>
          {member ? (
            // Identity role #1. The name is not repeated next to it, so the square is decorative.
            <Avatar
              member={member}
              size="md"
              identitySet={identitySet}
              decorative
              className={s.bigAvatar}
            />
          ) : null}
          <div className={s.identityText}>
            <h2 className={s.joinedTitle}>{title}</h2>
            {colourNote ? <span className={s.colour}>{colourNote}</span> : null}
          </div>
        </div>

        <p className={s.read}>{copy.joinedBody}</p>

        {people.length > 0 ? (
          <div className={s.presence}>
            <AvatarStack
              members={[...people]}
              size="sm"
              identitySet={identitySet}
              showStatus={false}
              showSummary={false}
              max={people.length}
              label={copy.presenceGroup}
            />
            {presenceNote ? <span className={s.presenceText}>{presenceNote}</span> : null}
          </div>
        ) : null}

        {onOpenConversation ? (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            className={s.cta}
            onClick={onOpenConversation}
          >
            {copy.open}
          </Button>
        ) : null}

        <p className={s.footnote}>{copy.footnote}</p>
      </section>
    );
  }

  return (
    <form className={cx(s.card, className)} onSubmit={handleSubmit} aria-label={copy.title}>
      <div className={s.intro}>
        <h2 className={s.title}>{copy.title}</h2>
        <p className={s.read}>{copy.body}</p>
      </div>

      <div className={s.code} role="group" aria-label={copy.codeGroup}>
        {groups.map((group, index) => (
          // The groups are positional, never reordered and never identified by content, so the
          // index is the only stable key there is.
          <Fragment key={index}>
            {index > 0 ? (
              <span className={s.separator} aria-hidden="true">
                {copy.separator}
              </span>
            ) : null}
            <input
              ref={(node) => {
                inputs.current[index] = node;
              }}
              className={s.cell}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={INVITE_CODE_GROUP_SIZE}
              value={group}
              aria-label={copy.codeGroupItem.replace('{n}', String(index + 1))}
              aria-invalid={error !== undefined || undefined}
              aria-describedby={error !== undefined ? errorId : undefined}
              onChange={(event) => write(index, normalizeCode(event.currentTarget.value))}
              onKeyDown={handleKeyDown(index)}
              onPaste={handlePaste(index)}
            />
          </Fragment>
        ))}
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        className={s.cta}
        loading={joining}
        loadingLabel={copy.joining}
        disabled={!complete}
      >
        {copy.submit}
      </Button>

      {error !== undefined ? (
        <p className={s.error} id={errorId} role="alert">
          <Icon name="incident" className={s.errorGlyph} label={copy.errorLabel} />
          <span className={s.errorText}>{error}</span>
        </p>
      ) : null}
    </form>
  );
}
