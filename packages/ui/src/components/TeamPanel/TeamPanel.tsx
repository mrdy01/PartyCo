import type { ReactElement, ReactNode } from 'react';
import { Icon } from '@partyco/icons';
import type { IdentitySetName } from '@partyco/tokens';
import {
  MEMBER_ACTIVITY_LABEL,
  MEMBER_ACTIVITY_TONE,
  PROJECT_ROLE_LABEL,
  type InviteRecord,
  type ProjectMember,
} from '../AppShell/model.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ErrorState } from '../ErrorState/ErrorState.tsx';
import { IconButton } from '../IconButton/IconButton.tsx';
import { LoadingState } from '../LoadingState/LoadingState.tsx';
import s from './TeamPanel.module.css';

/* ----------------------------------------------------------------- labels */

export interface TeamPanelLabels {
  /** Panel title. */
  title: string;
  /**
   * Head-count noun in its three Russian forms: `1 человек`, `4 человека`, `5 человек`.
   * A single string cannot spell the count correctly, and a count spelled wrong is the first
   * thing a reader notices in a panel that is otherwise about people.
   */
  people: readonly [string, string, string];
  close: string;
  membersSection: string;
  invitesSection: string;
  /** Right-hand marker on the local user's row. */
  self: string;
  /** Full-width call to action. */
  invite: string;
  /** Accessible name of the glyph in front of an e-mail invitation. */
  inviteByEmail: string;
  /** Accessible name of the glyph in front of a code invitation. */
  inviteByCode: string;
  emptyTitle: string;
  emptyBody: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  loading: string;
  /** Accessible name of the member list. */
  membersList: string;
  /** Accessible name of the invitation list. */
  invitesList: string;
}

export const TEAM_PANEL_LABELS: TeamPanelLabels = {
  title: 'Команда',
  people: ['человек', 'человека', 'человек'],
  close: 'Закрыть команду',
  membersSection: 'В проекте',
  invitesSection: 'Приглашения',
  self: 'это ты',
  invite: 'Позвать в проект',
  inviteByEmail: 'Приглашение по почте',
  inviteByCode: 'Приглашение по коду',
  emptyTitle: 'В проекте пока только ты',
  emptyBody: 'Позови того, с кем работаешь, — по почте или по коду. Зоны разделятся сами, когда вас станет двое.',
  errorTitle: 'Не получилось показать команду',
  errorBody: 'Хаб не ответил. Твоя работа на месте — и правки, и зона. Это только список людей.',
  retry: 'Попробовать снова',
  loading: 'Собираем список команды',
  membersList: 'Участники проекта',
  invitesList: 'Открытые приглашения',
};

export type TeamPanelLabelsInput = Partial<Omit<TeamPanelLabels, 'people'>> & {
  people?: readonly [string, string, string] | undefined;
};

/**
 * Merge one level deeper than a spread: `people` is a tuple, and a shallow `...input` would let a
 * caller who only wanted to rename the title drop two of its three forms. A partial override of a
 * copy block once wiped an entire panel's wording that way.
 */
function mergeLabels(input?: TeamPanelLabelsInput): TeamPanelLabels {
  if (!input) return TEAM_PANEL_LABELS;
  return {
    ...TEAM_PANEL_LABELS,
    ...input,
    people: input.people ?? TEAM_PANEL_LABELS.people,
  };
}

/** Russian plural slot for `n`: 0 → «человек», 1 → «человека», 2 → «человек». */
function pluralSlot(n: number): 0 | 1 | 2 {
  const hundred = Math.abs(Math.trunc(n)) % 100;
  const ten = hundred % 10;
  if (hundred >= 11 && hundred <= 14) return 2;
  if (ten === 1) return 0;
  if (ten >= 2 && ten <= 4) return 1;
  return 2;
}

/* ------------------------------------------------------------------ props */

/** Convention §6: every panel states its three states up front, not «потом». */
export type TeamPanelState = 'ready' | 'loading' | 'error';

export interface TeamPanelProps {
  members: readonly ProjectMember[];
  /** Invitations still open. Absent or empty and the whole section disappears. */
  invites?: readonly InviteRecord[] | undefined;
  state?: TeamPanelState | undefined;
  /** Footnote pinned to the bottom of the panel, next to the `info` glyph. */
  footnote?: ReactNode;
  identitySet?: IdentitySetName | undefined;
  /** Renders the close control. Omit and the panel has no header button. */
  onClose?: (() => void) | undefined;
  /** Opens the invite panel. Omit and the call to action is not drawn. */
  onInvite?: (() => void) | undefined;
  /** Makes each member row a button. Omit and the rows are plain text. */
  onMemberSelect?: ((member: ProjectMember) => void) | undefined;
  /** Retry for the error state. */
  onRetry?: (() => void) | undefined;
  labels?: TeamPanelLabelsInput | undefined;
  className?: string | undefined;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------- rows */

interface MemberRowProps {
  member: ProjectMember;
  identitySet: IdentitySetName | undefined;
  selfLabel: string;
  onSelect: ((member: ProjectMember) => void) | undefined;
}

/**
 * One 42px person. The avatar carries the member's colour — identity role #1 and the only place
 * this panel spends it. Activity is a dot plus a word, never a fill: an offline teammate gets grey
 * text and no dot at all, because a dot is a claim that something is happening right now.
 */
function MemberRow({ member, identitySet, selfLabel, onSelect }: MemberRowProps): ReactElement {
  const activity = member.activity;
  const tone = activity ? MEMBER_ACTIVITY_TONE[activity] : null;

  const trailing = member.isSelf ? (
    <span className={s.you}>{selfLabel}</span>
  ) : member.activityNote ? (
    <span className={s.trailingNote}>{member.activityNote}</span>
  ) : activity ? (
    <span className={s.activity}>
      {tone ? <span className={s.dot} data-tone={tone} aria-hidden="true" /> : null}
      <span className={tone ? s.activityText : s.trailingNote}>{MEMBER_ACTIVITY_LABEL[activity]}</span>
    </span>
  ) : null;

  const body = (
    <>
      {/* The name is real text one line away, so the square is decorative. */}
      <Avatar member={member} size="md" identitySet={identitySet} decorative className={s.avatar} />
      <span className={s.person}>
        <span className={s.name}>{member.name}</span>
        <span className={s.handle}>
          @{member.handle} · {PROJECT_ROLE_LABEL[member.role]}
        </span>
      </span>
      {trailing}
    </>
  );

  if (onSelect) {
    return (
      <li className={s.item}>
        <button type="button" className={cx(s.row, s.rowButton)} onClick={() => onSelect(member)}>
          {body}
        </button>
      </li>
    );
  }

  return (
    <li className={s.item}>
      <div className={s.row}>{body}</div>
    </li>
  );
}

interface InviteRowProps {
  invite: InviteRecord;
  emailLabel: string;
  codeLabel: string;
}

function InviteRow({ invite, emailLabel, codeLabel }: InviteRowProps): ReactElement {
  const byEmail = invite.channel === 'email';
  const value = byEmail ? invite.email : invite.code;
  return (
    <li className={s.item}>
      <div className={s.inviteRow}>
        <Icon
          name={byEmail ? 'mail' : 'lease'}
          className={byEmail ? s.mailGlyph : s.codeGlyph}
          label={byEmail ? emailLabel : codeLabel}
        />
        <span className={byEmail ? s.mono : s.monoCode}>{value}</span>
        <span className={s.trailingNote}>{invite.meta}</span>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ panel */

/**
 * «Команда» — the slide-out the avatars in the conversation's corner open.
 *
 * It answers three questions in the order a person asks them: who is here, who has been asked, and
 * how do I ask somebody else. Nothing else: roles are read-only here and are handed out in
 * `InvitePanel`, because a list you can accidentally edit is a list you stop trusting.
 *
 * Words come from `AppShell/model.ts` — `PROJECT_ROLE_LABEL`, `MEMBER_ACTIVITY_LABEL` and
 * `MEMBER_ACTIVITY_TONE` — rather than from strings typed here, so the panel and the ownership
 * board cannot end up calling the same role two different things.
 */
export function TeamPanel({
  members,
  invites,
  state = 'ready',
  footnote,
  identitySet,
  onClose,
  onInvite,
  onMemberSelect,
  onRetry,
  labels,
  className,
}: TeamPanelProps): ReactElement {
  const copy = mergeLabels(labels);
  const openInvites = invites ?? [];
  const isEmpty = members.length === 0 && openInvites.length === 0;

  /*
   * Only while the list is real. During loading and after a failure `members` is empty for want of
   * an answer, not because the project has nobody in it — and «0 человек» in the header of a panel
   * that is still asking is a statement the panel cannot back up.
   */
  const count =
    state === 'ready' ? `${members.length} ${copy.people[pluralSlot(members.length)]}` : null;

  const footnoteBlock =
    footnote !== undefined && footnote !== null && footnote !== '' ? (
      <div className={s.footnote}>
        <Icon name="info" className={s.footnoteGlyph} />
        <p className={s.footnoteText}>{footnote}</p>
      </div>
    ) : null;

  let body: ReactElement;

  if (state === 'loading') {
    body = (
      <div className={s.stateBlock}>
        <LoadingState rows={4} caption={copy.loading} label={copy.loading} />
      </div>
    );
  } else if (state === 'error') {
    body = (
      <div className={s.stateBlock}>
        <ErrorState
          title={copy.errorTitle}
          description={copy.errorBody}
          {...(onRetry ? { onRetry } : {})}
          retryLabel={copy.retry}
        />
      </div>
    );
  } else if (isEmpty) {
    body = (
      <>
        <div className={s.stateBlock}>
          <EmptyState
            icon="team"
            title={copy.emptyTitle}
            description={copy.emptyBody}
            {...(onInvite ? { actions: [{ label: copy.invite, onClick: onInvite }] } : {})}
          />
        </div>
        {footnoteBlock}
      </>
    );
  } else {
    body = (
      <>
        {members.length > 0 ? (
          <section className={s.section}>
            <h3 className={s.sectionTitle}>{copy.membersSection}</h3>
            <ul className={s.list} aria-label={copy.membersList}>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  identitySet={identitySet}
                  selfLabel={copy.self}
                  onSelect={onMemberSelect}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {openInvites.length > 0 ? (
          <section className={s.section}>
            <h3 className={s.sectionTitle}>{copy.invitesSection}</h3>
            <ul className={s.list} aria-label={copy.invitesList}>
              {openInvites.map((invite) => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  emailLabel={copy.inviteByEmail}
                  codeLabel={copy.inviteByCode}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {onInvite ? (
          <Button
            variant="primary"
            size="lg"
            icon="member-add"
            fullWidth
            className={s.cta}
            onClick={onInvite}
          >
            {copy.invite}
          </Button>
        ) : null}

        {footnoteBlock}
      </>
    );
  }

  return (
    <section className={cx(s.panel, className)} aria-label={copy.title}>
      <header className={s.header}>
        <h2 className={s.title}>{copy.title}</h2>
        {count ? <span className={s.count}>{count}</span> : null}
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
      <div className={s.body}>{body}</div>
    </section>
  );
}
