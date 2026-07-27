/**
 * The shell's shared vocabulary and data shapes.
 *
 * SINGLE SOURCE. Every panel of the new shell — rail, status line, conversation, event cards, file
 * tree, ownership board, team panel — reads its types and its Russian wording from here, not from
 * whichever component happened to need them first. On the merge-queue screen this file existing
 * before the panels were written is the only reason six panels stayed in agreement; the leases
 * screen, where it did not, ended up with two overlapping sets of fixtures.
 *
 * Transcribed from `design/raw/PartyCo Shell.dc.html` (dark half). Where the designer changed the
 * wording of something we already shipped, the new wording wins and the old one is not kept as a
 * fallback — two names for one thing is how a glossary rots.
 *
 * Nothing here knows about the network. Data arrives as props; demo data lives in
 * `src/fixtures/shell.ts`.
 */

import type { Member } from '../../identity.ts';
import type { AgentMode } from '../AgentModeSelector/AgentModeSelector.tsx';

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

/**
 * The word for a held boundary, in the interface: **зона**.
 *
 * The owner asked for `lease` in Latin and undeclined; the designer went one step further and
 * argued that on someone's first day `lease` means nothing while «зона» means something, so Latin
 * `lease` retreats to the hover hint, the documents and the API. That is the one place the design
 * deliberately departs from the brief, and it is flagged in the export's notes as such.
 *
 * `leaseWord` in `identity.ts` still exists for the three original screens; new surfaces use this.
 */
export const ZONE_WORD = 'зона';

/** What the hover hint says, so the term survives for anyone who read the documents. */
export const ZONE_TERM_HINT = 'lease';

/**
 * Plain-language names for the agent's authority. `AGENT_MODE_LABEL` («План», «Приём правок»,
 * «Авто») is the operator's vocabulary and stays where the old screens use it; the composer chip a
 * person reads twenty times a day says what the mode actually does.
 */
export const AGENT_MODE_PLAIN_LABEL: Record<AgentMode, string> = {
  plan: 'Сначала план',
  'accept-edits': 'Спрашивает перед правкой',
  auto: 'Сам решает',
};

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

/**
 * Roles as the hub actually stores them (`member.role` — see `apps/hub/src/db.js`), not a new
 * parallel set. The Russian names are the designer's; the ability line is what the invite panel
 * shows next to each one.
 */
export type ProjectRole = 'owner' | 'maintainer' | 'member' | 'observer';

export const PROJECT_ROLES: readonly ProjectRole[] = ['owner', 'maintainer', 'member', 'observer'];

/**
 * The role in words, and deliberately **without naming the scope**.
 *
 * One `ProjectRole` now describes two different things: what somebody may do on the hub, and what
 * they may do inside one project. They are frequently different — the person who owns a project can
 * be a plain member of the hub — so a label that names one scope is wrong wherever the other is
 * shown. It said «хозяин хаба» until the team panel started listing a project's roster, and then it
 * told a project owner they ran the hub. Where the scope matters, the surrounding copy says it.
 */
export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = {
  owner: 'владелец',
  maintainer: 'мейнтейнер',
  member: 'участник',
  observer: 'только смотрит',
};

/** Capitalised form for a standalone control (the invite panel's radio list). */
export const PROJECT_ROLE_TITLE: Record<ProjectRole, string> = {
  owner: 'Владелец',
  maintainer: 'Мейнтейнер',
  member: 'Участник',
  observer: 'Только смотрит',
};

export const PROJECT_ROLE_ABILITY: Record<ProjectRole, string> = {
  owner: 'всё то же плюс убирает из проекта',
  maintainer: 'то же плюс правит границы зон',
  member: 'берёт зоны, пишет код, отправляет патчи',
  observer: 'видит работу, ничего не занимает',
};

/**
 * Which roles may be handed out in an invite. The owner is not among them: a hub has one, it is
 * whoever registered first, and there is no code that transfers it — so offering it in a dropdown
 * would be a promise the service does not keep.
 */
export const INVITABLE_ROLES: readonly ProjectRole[] = ['maintainer', 'member', 'observer'];

/** What a teammate is doing, as the team panel and the ownership board say it. */
export type MemberActivity = 'editing' | 'checking' | 'waiting' | 'idle' | 'offline';

export const MEMBER_ACTIVITY_LABEL: Record<MemberActivity, string> = {
  editing: 'правит',
  checking: 'ждёт проверки',
  waiting: 'освободится',
  idle: 'ничего не делает',
  offline: 'офлайн',
};

/**
 * Status colour for an activity. `null` means "no dot" — an offline teammate gets grey text and no
 * indicator, because a dot is a claim that something is happening.
 */
export const MEMBER_ACTIVITY_TONE: Record<MemberActivity, 'running' | 'success' | 'warning' | null> = {
  editing: 'running',
  checking: 'success',
  waiting: 'warning',
  idle: null,
  offline: null,
};

/**
 * A member as the shell shows them: the identity `Member` plus the two things the hub knows and the
 * old screens did not need — the handle and the role.
 */
export interface ProjectMember extends Member {
  handle: string;
  role: ProjectRole;
  activity?: MemberActivity;
  /** Free-form right-hand note, e.g. «офлайн 2 дня». Wins over the activity label when present. */
  activityNote?: string;
}

/* ------------------------------------------------------------------ *
 * The shell itself
 * ------------------------------------------------------------------ */

/**
 * What the 52px rail switches between.
 *
 * Four entries, and the merge queue is deliberately not one of them: a queue is a state, not a
 * place, so it lives as a tab inside «Владение» and as cards in the stream. `+` above the list
 * starts a new task, which in this product is the same act as starting a new conversation.
 */
export type ShellView = 'conversation' | 'files' | 'ownership' | 'settings';

export const SHELL_VIEWS: readonly {
  id: ShellView;
  label: string;
  icon: 'tasks' | 'folder' | 'team' | 'settings';
}[] = [
  { id: 'conversation', label: 'Разговор', icon: 'tasks' },
  { id: 'files', label: 'Файлы', icon: 'folder' },
  { id: 'ownership', label: 'Владение', icon: 'team' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

/* ---------- status line ---------- */

/** How this machine reaches the rest of the team. */
export type ShellConnectionKind = 'direct' | 'relay' | 'offline';

export const SHELL_CONNECTION_LABEL: Record<ShellConnectionKind, string> = {
  direct: 'Связь напрямую',
  relay: 'Связь через сервер команды',
  offline: 'Связи с командой нет — работаешь один',
};

export const SHELL_CONNECTION_TONE: Record<ShellConnectionKind, 'success' | 'warning' | 'danger'> = {
  direct: 'success',
  relay: 'warning',
  offline: 'danger',
};

export type ShellTrunkState = 'healthy' | 'broken';

export const SHELL_TRUNK_LABEL: Record<ShellTrunkState, string> = {
  healthy: 'Ствол здоров',
  broken: 'Ствол красный',
};

/**
 * The six fields that used to sit in the status bar and now live behind «Подробности».
 *
 * They are not deleted — the owner's own hypothesis was that only connection, trunk and spend must
 * be visible always, and the designer took it unchanged. `stateVersion` in particular is a
 * monotonic counter the human occasionally needs and never needs to watch.
 */
export interface ShellStatusDetail {
  stateVersion?: number;
  /** How many zones the project currently has held, across everyone. */
  zoneCount?: number;
  queueDepth?: number;
  /** One line about the local user's own zone, e.g. «зона держится непрерывно». */
  zoneNote?: string;
}

/**
 * Every field but `connection` is optional, and that is a product decision rather than convenience.
 *
 * The subsystems behind these numbers arrive one at a time — the gate decides whether the trunk is
 * healthy, the core daemon counts `state_version` and held zones, the run accounting knows what the
 * day cost. Until each one exists there is no honest value to print, and a plausible one would be
 * worse than a gap: a person who trusts «Ствол здоров» when nothing checked the trunk is being
 * misled by their own tool. `StatusLine` therefore draws the fields it was given and leaves out the
 * rest, including the «Подробности» disclosure when there is nothing behind it.
 */
export interface ShellStatus {
  connection: ShellConnectionKind;
  /** Rendered only for `direct` and `relay`; offline has no latency to report. */
  latencyLabel?: string;
  /** Absent until something actually checks the trunk. */
  trunk?: ShellTrunkState;
  /**
   * Today's spend, not the session's: a per-session number is a quantity a person cannot compare
   * with anything. Two parts because the design shows tokens and money side by side. Both absent
   * together — half a spend field says nothing.
   */
  spendLabel?: string;
  costLabel?: string;
  detail?: ShellStatusDetail;
  /** Replaces the spend field while the team is unreachable — zones are not handed out offline. */
  offlineNote?: string;
}

/* ------------------------------------------------------------------ *
 * The five events that may interrupt
 * ------------------------------------------------------------------ */

/**
 * Everything else is quiet: spend, `state_version`, other people's zones far from mine, ordinary
 * merges, teammates arriving and leaving.
 *
 * The first four are the owner's list, taken whole. `agent-waiting` is the designer's addition and
 * the argument for it is sound — without it a stopped agent looks exactly like a working one.
 */
export type ShellEventKind =
  | 'gate-rejected'
  | 'trunk-red'
  | 'zone-requested'
  | 'foreign-write'
  | 'agent-waiting';

export const SHELL_EVENT_TITLE: Record<ShellEventKind, string> = {
  'gate-rejected': 'Патч не пропущен гейтом',
  'trunk-red': 'Ствол красный',
  'zone-requested': 'Просят твою зону',
  'foreign-write': 'В твою зону записали',
  'agent-waiting': 'Агент ждёт решения',
};

/**
 * The status colour of the event's dot. Only a dot — never the card's fill, never a left edge.
 *
 * `zone-requested` has no entry because it is marked by the asker's avatar instead: it is a person
 * asking, not a mechanism reporting, and the avatar says who.
 */
export const SHELL_EVENT_TONE: Record<ShellEventKind, 'warning' | 'danger' | 'running' | null> = {
  'gate-rejected': 'warning',
  'trunk-red': 'danger',
  'zone-requested': null,
  'foreign-write': 'warning',
  'agent-waiting': 'running',
};

export interface ShellEventAction {
  id: string;
  label: string;
  /** Exactly one action per card may be primary — the card has one first action, by design. */
  primary?: boolean;
}

export interface ShellEvent {
  id: string;
  kind: ShellEventKind;
  /** Overrides `SHELL_EVENT_TITLE` when the person's name belongs in it («Марина просит твою зону»). */
  title?: string;
  /** What happened, what it means for my work, in ordinary words. Never a raw mechanism string. */
  body: string;
  /** Relative age. Wall-clock is not shown — see architecture §7. */
  age: string;
  actions?: readonly ShellEventAction[];
  /** Trailing reassurance next to the actions, e.g. «Твоя зона этого теста не касается». */
  aside?: string;
  /** Present for `zone-requested`: the teammate asking. Their avatar replaces the status dot. */
  member?: ProjectMember;
  /**
   * Draws a 3px stripe along the **top** of the card in the event's tone.
   *
   * Deliberately the top edge, not the left: a left edge in a status colour is the one thing
   * CONVENTIONS §5 forbids outright, because the left edge is where a member's colour says "this
   * is my zone" and the two must never be confusable.
   */
  emphasised?: boolean;
}

/* ------------------------------------------------------------------ *
 * The conversation stream
 * ------------------------------------------------------------------ */

/** One file the agent touched, as the expanded work summary lists it. */
export interface WorkStep {
  file: string;
  note: string;
}

/** What the person asked for. */
export interface PromptItem {
  kind: 'prompt';
  id: string;
  author: ProjectMember;
  text: string;
}

/** The agent talking. Plain prose — no reasoning dump, no tool-call list. */
export interface ReplyItem {
  kind: 'reply';
  id: string;
  text: string;
}

/**
 * The agent session, collapsed to one line.
 *
 * `AgentSessionPanel` is not deleted and not forked — reasoning, tool calls, modes and enforcement
 * coverage all still live in it. This is the handle that opens it.
 */
export interface WorkItem {
  kind: 'work';
  id: string;
  /** «Правил 2 файла, прочитал 4». */
  summary: string;
  added: number;
  removed: number;
  /** Trailing link, e.g. «посмотреть дифф». Absent when there is nothing to open. */
  diffLabel?: string;
  /** Shown when the row is expanded. */
  steps?: readonly WorkStep[];
  expanded?: boolean;
}

/**
 * A teammate's move, in the same ribbon as the agent's answers.
 *
 * This is the inversion the brief asked for: co-presence is an event, not a permanent panel. The
 * card carries the member's colour as a 2px left edge — identity role #2, the same edge the file
 * tree uses — and says plainly whether it touches my work.
 */
export interface PresenceItem {
  kind: 'presence';
  id: string;
  member: ProjectMember;
  text: string;
  /** «2 минуты назад · твоей работы не касается». */
  meta: string;
}

/** Something is running: in the gate queue, tests, a long tool call. */
export interface RunItem {
  kind: 'run';
  id: string;
  label: string;
  /** «осталось 18 с». */
  hint?: string;
}

/** One of the five interruptions, rendered inline in the stream. */
export interface EventItem {
  kind: 'event';
  id: string;
  event: ShellEvent;
}

export type ConversationItem =
  | PromptItem
  | ReplyItem
  | WorkItem
  | PresenceItem
  | RunItem
  | EventItem;

/** What the composer's chips currently say. */
export interface ComposerContext {
  /** The zone the next instruction will land in, e.g. `packages/economy`. */
  zonePath?: string;
  /** «твоя зона» — omitted when the zone is not held by the local user. */
  zoneNote?: string;
  mode: AgentMode;
  /** Provider slug for the small glyph, e.g. `anthropic`. */
  providerId: string;
  /** Model as a person names it, e.g. `sonnet-4-6`. */
  modelLabel: string;
}

/* ------------------------------------------------------------------ *
 * Zones — files panel and ownership view
 * ------------------------------------------------------------------ */

export type ZoneState = 'mine' | 'held' | 'free' | 'disputed';

/** One row of the 236px files panel. Zones and the files inside them share the row shape. */
export interface ZoneTreeNode {
  id: string;
  /** Zone path (`packages/economy`) or bare file name (`wallet.ts`). */
  label: string;
  kind: 'zone' | 'file';
  /** Owner of the zone this row belongs to. Absent for unclaimed ground. */
  owner?: ProjectMember;
  state: ZoneState;
  expanded?: boolean;
  selected?: boolean;
  /** `+19` next to a file the agent changed. */
  addedLabel?: string;
  /** Draws the padlock: the file is under mechanical protection. */
  guarded?: boolean;
  /** Draws a danger dot: something here is disputed. */
  flagged?: boolean;
}

/** One card on the ownership board. */
export interface ZoneCardData {
  path: string;
  state: ZoneState;
  holder?: ProjectMember;
  /** «Правишь · 4 минуты», «Не трогала 27 минут». */
  activity?: string;
  /** «Зона отпустится сама через 3 минуты». */
  release?: string;
  /** «14.2 тысячи строк». */
  size?: string;
  /** Right-hand state chip on a held card: label plus its status tone. */
  chip?: { label: string; tone: 'success' | 'warning' | 'danger' | 'running' };
  /** Body text on a disputed card. */
  note?: string;
  action?: { id: string; label: string };
}

/** One row of the ownership table under the cards. */
export interface ZoneTableRow {
  path: string;
  holder?: ProjectMember;
  /** «Правит и запускает тесты». */
  doing: string;
  /** «Пока работаешь — держится», «Через 3 минуты сама». */
  release: string;
  releaseTone?: 'success' | 'warning' | 'danger' | null;
  action?: { id: string; label: string };
}

/** Tabs of the «Владение» view. The merge queue is one of them, not a screen. */
export type OwnershipTab = 'zones' | 'queue';

/* ------------------------------------------------------------------ *
 * File viewer
 * ------------------------------------------------------------------ */

export interface FileViewerLine {
  number: number;
  text: string;
  change?: 'added' | 'removed';
}

export interface FileViewerModel {
  name: string;
  /** Directory shown next to the name, e.g. `packages/economy/src`. */
  dir: string;
  lines: readonly FileViewerLine[];
  /** Present when the file sits inside a zone; drives the gutter tint and the header chip. */
  zone?: { owner: ProjectMember; label: string };
  /** Floating note over the code, e.g. «твой агент правил это 3 минуты назад». */
  marker?: { member: ProjectMember; text: string };
}

/* ------------------------------------------------------------------ *
 * Team and invitations
 * ------------------------------------------------------------------ */

export type InviteChannel = 'email' | 'code';

/**
 * `exhausted` is a multi-seat code that ran out of seats, and it is deliberately not folded into
 * `accepted`: five people accepted, and the code is also now useless. Whoever handed it out needs
 * to see the second fact, because the fix is a new code rather than a reminder.
 */
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked' | 'exhausted';

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  pending: 'ждёт ответа',
  accepted: 'принято',
  expired: 'истекло',
  revoked: 'отменено',
  exhausted: 'мест больше нет',
};

export const INVITE_STATUS_TONE: Record<InviteStatus, 'success' | 'warning' | 'danger' | null> = {
  pending: 'warning',
  accepted: 'success',
  expired: null,
  revoked: null,
  exhausted: null,
};

export interface InviteRecord {
  id: string;
  channel: InviteChannel;
  /** Set for an email invitation. */
  email?: string;
  /** Set for a code invitation: `HTAK-4K7M-9ZQD`. */
  code?: string;
  role: ProjectRole;
  status: InviteStatus;
  /** Right-hand note: «письмо ушло 10 минут назад», «1 из 5 · ещё 21 час». */
  meta: string;
  /** Trailing action link: «Отменить», «Позвать снова». */
  action?: { id: string; label: string };
}

/** How long a code invitation lives. */
export type InviteLifetime = 'day' | 'week' | 'forever';

export const INVITE_LIFETIME_LABEL: Record<InviteLifetime, string> = {
  day: 'Сутки',
  week: 'Неделю',
  forever: 'Пока не отключу',
};

/** How many people one code lets in. */
export type InviteSeats = 'one' | 'five' | 'any';

export const INVITE_SEATS_LABEL: Record<InviteSeats, string> = {
  one: 'Одного',
  five: 'Пятерых',
  any: 'Сколько угодно',
};

/**
 * The code alphabet: Latin letters and digits with every look-alike removed — no `O`, no `0`,
 * no `I`, no `l`, no `1`. A code is meant to survive being read aloud once.
 *
 * `apps/hub/src/invites.js` carries the same string; the two are checked against each other by the
 * hub's test suite rather than by hope.
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * `HTAK-4K7M-9ZQD` — three groups of four.
 *
 * Note the sample is not the designer's: theirs reads `HTAL-…`, and `L` is one of the look-alikes
 * the alphabet above drops, so that code cannot exist. The hub refuses it by test.
 */
export const INVITE_CODE_GROUPS = 3;
export const INVITE_CODE_GROUP_SIZE = 4;

/* ------------------------------------------------------------------ *
 * First run
 * ------------------------------------------------------------------ */

/**
 * Two steps, both skippable: the project folder and a provider key. Theme, density, inviting the
 * team and marking out zones all arrive later, out of the work — a ten-step wizard in front of a
 * product nobody has seen yet teaches nothing.
 */
export interface FirstRunProvider {
  id: string;
  label: string;
  /** One letter shown in the small square, e.g. `A` for Anthropic. */
  glyph: string;
  /** Placeholder shape of the key, e.g. `sk-ant-api03-…`. */
  keyHint: string;
}

export const FIRST_RUN_PROVIDERS: readonly FirstRunProvider[] = [
  { id: 'anthropic', label: 'Anthropic', glyph: 'A', keyHint: 'sk-ant-api03-…' },
  { id: 'openai', label: 'OpenAI', glyph: 'O', keyHint: 'sk-proj-…' },
  { id: 'google', label: 'Google', glyph: 'G', keyHint: 'AIza…' },
];

/**
 * The guarantee about provider keys, stated where a person reads it before typing one — on the
 * sign-in screen and on the key step, not buried in settings. It is a claim about what the product
 * is, and `CredentialGuarantee` exists to render it.
 */
export const KEY_GUARANTEE =
  'Ключи не покидают эту машину: API-ключи провайдеров остаются на твоём компьютере, хаб видит только имя модели и счётчик токенов.';

export const KEY_GUARANTEE_STORAGE =
  'Ключ ляжет в хранилище Windows, рядом с паролями браузера. В сообщениях хабу для него нет поля — он туда физически не попадёт.';
