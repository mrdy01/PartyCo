import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppShell,
  Composer,
  ContextRail,
  Conversation,
  EventCard,
  FileViewer,
  GateRejectionPanel,
  InvitePanel,
  MergeQueueTable,
  ShellTitleBar,
  StatusLine,
  TeamPanel,
  ZoneBoard,
  ZoneTree,
  useTheme,
  type InviteChannel,
  type InviteLifetime,
  type InviteRecord,
  type InviteSeats,
  type OwnershipTab,
  type ProjectMember,
  type ProjectRole,
  type ShellView,
  type ZoneTreeNode,
} from '@partyco/ui';
import {
  shellComposer,
  shellEmptyGreeting,
  shellEventGateRejected,
  shellFileWith,
  shellOwnershipMeta,
  shellStatusWith,
  shellStreamWith,
  shellTaskZone,
  shellTeamFootnote,
  shellTree,
  shellTreeFootnote,
  shellZoneCards,
  shellZoneRows,
  shellZoneTermNote,
  useShellClock,
} from '@partyco/ui/fixtures/shell';
import {
  mergeQueueInterveningRejection,
  mergeQueueRowsAt,
  useMergeQueueClock,
} from '@partyco/ui/fixtures/mergequeue';
import {
  canManageInvites,
  toInviteRecord,
  toProjectMember,
} from '../present.ts';
import {
  createInvite as hubCreateInvite,
  invites as hubInvites,
  members as hubMembers,
  revokeInvite as hubRevokeInvite,
  type HubInvite,
  type HubSession,
} from '../hub.ts';
import styles from './Shell.module.css';

/**
 * The product shell — screens 03–06 and 2a of `design/raw/PartyCo Shell.dc.html`.
 *
 * The whole revision is in what this page does NOT render on open: no boundary tree, no agent
 * session panel, no ownership map, no merge queue, no nine-field status bar. One column of
 * conversation, three fields of state, three avatars in the corner. Everything else arrives because
 * somebody asked for it, and leaves again when they close it.
 *
 * Two data sources, and the difference matters. **The team and its invitations are real** — they
 * come from `partycod` over HTTP, and inviting somebody actually creates a row that actually lets
 * them in. Everything else on this page is still fixtures from `@partyco/ui/fixtures/shell`,
 * because the core daemon does not exist yet. That boundary is the remaining roadmap, and it is
 * drawn here rather than hidden: `useTeam` below is the only hook that can fail, and it is the only
 * one with a loading and an error state.
 */

/** What may occupy the slide-out panel on the right. Nothing, by default and after every close. */
type Detail = 'gate' | 'team' | 'invite' | null;

export function ShellPage({
  session,
  onSignOut,
}: {
  session: HubSession;
  onSignOut: () => void;
}): React.ReactElement {
  const clock = useShellClock();
  const queueClock = useMergeQueueClock();

  const [view, setView] = useState<ShellView>('conversation');
  const [detail, setDetail] = useState<Detail>(null);
  const [statusExpanded, setStatusExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [workExpanded, setWorkExpanded] = useState(false);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    shellTree.find((n) => n.selected)?.id,
  );
  const [ownershipTab, setOwnershipTab] = useState<OwnershipTab>('zones');

  const team = useTeam(session);
  const self = useMemo(
    () => toProjectMember(session.member, session.member.id),
    [session.member],
  );

  /* ---------- the stream ---------- */

  const stream = useMemo(() => {
    const items = shellStreamWith(clock).map((item) =>
      item.kind === 'work' ? { ...item, expanded: workExpanded } : item,
    );
    return items;
  }, [clock, workExpanded]);

  const status = useMemo(() => shellStatusWith(clock), [clock]);
  const file = useMemo(() => shellFileWith(clock), [clock]);

  /* ---------- the files panel ---------- */

  const nodes = useMemo<readonly ZoneTreeNode[]>(
    () => shellTree.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [selectedNodeId],
  );

  const openFile = useCallback((node: ZoneTreeNode) => {
    setSelectedNodeId(node.id);
    if (node.kind === 'file') setOpenFileId(node.id);
  }, []);

  /* ---------- chrome ---------- */

  const titleBar = (
    <ShellTitleBar
      projectName={PROJECT_NAME}
      searchValue={search}
      onSearchChange={setSearch}
      searchShortcut={['Ctrl', 'K']}
    />
  );

  const rail = (
    <ContextRail
      view={view}
      onViewChange={(next) => {
        setView(next);
        // The rail switches the context of work, not a modal stack: moving to another view closes
        // whatever was slid out over the previous one.
        setDetail(null);
      }}
      projectInitial={PROJECT_NAME.slice(0, 1)}
      onNewTask={() => setDraft('')}
      self={self}
    />
  );

  const statusLine = (
    <StatusLine
      status={status}
      expanded={statusExpanded}
      onToggleDetails={() => setStatusExpanded((open) => !open)}
    />
  );

  /* ---------- the slide-out panel ---------- */

  const detailPanel =
    detail === 'gate' ? (
      <GateRejectionPanel
        rejection={mergeQueueInterveningRejection}
        claimId="c-2288"
        onClose={() => setDetail(null)}
      />
    ) : detail === 'team' ? (
      <TeamPanel
        members={team.members}
        invites={team.invites}
        state={team.state}
        footnote={shellTeamFootnote}
        onClose={() => setDetail(null)}
        {...(canManageInvites(session.member) ? { onInvite: () => setDetail('invite') } : {})}
        onRetry={team.reload}
      />
    ) : detail === 'invite' ? (
      <InvitePanel
        channel={team.channel}
        onChannelChange={team.setChannel}
        email={team.email}
        onEmailChange={team.setEmail}
        {...(team.error ? { emailError: team.error } : {})}
        role={team.role}
        onRoleChange={team.setRole}
        sending={team.sending}
        onSend={team.send}
        sentInvites={team.invites}
        onInviteAction={team.revoke}
        {...(team.code ? { code: team.code } : {})}
        {...(team.link ? { link: team.link } : {})}
        lifetime={team.lifetime}
        onLifetimeChange={team.setLifetime}
        seats={team.seats}
        onSeatsChange={team.setSeats}
        onRotate={team.rotate}
        onCopy={copyToClipboard}
        onClose={() => setDetail('team')}
      />
    ) : null;

  /* ---------- the main column ---------- */

  const composer = (
    <Composer
      context={{ ...shellComposer, zonePath: shellTaskZone }}
      self={self}
      value={draft}
      onValueChange={setDraft}
      onSubmit={() => setDraft('')}
      variant={view === 'files' ? 'narrow' : 'wide'}
      {...(view === 'files' ? { copy: { placeholder: 'Спросить про этот файл…' } } : {})}
    />
  );

  const conversation = (
    <Conversation
      items={stream}
      variant={view === 'files' ? 'narrow' : 'wide'}
      renderEvent={(event) => (
        <EventCard
          event={event}
          onAction={(actionId) => {
            if (actionId === 'diff') setDetail('gate');
          }}
        />
      )}
      onToggleWork={() => setWorkExpanded((open) => !open)}
      onOpenDiff={() => setDetail('gate')}
      copy={{ empty: { title: shellEmptyGreeting.title, body: shellEmptyGreeting.body } }}
      footer={composer}
    />
  );

  const main =
    view === 'ownership' ? (
      <ZoneBoard
        tab={ownershipTab}
        onTabChange={setOwnershipTab}
        cards={shellZoneCards}
        rows={shellZoneRows}
        queueCount={2}
        meta={shellOwnershipMeta}
        footnote={shellZoneTermNote}
        renderQueue={() => <MergeQueueTable rows={mergeQueueRowsAt(queueClock)} />}
      />
    ) : view === 'settings' ? (
      <SettingsView
        self={self}
        memberCount={team.members.length}
        onOpenTeam={() => setDetail('team')}
        onSignOut={onSignOut}
      />
    ) : view === 'files' && openFileId ? (
      <div className={styles.split}>
        <div className={styles.narrowColumn}>{conversation}</div>
        <FileViewer file={file} onClose={() => setOpenFileId(null)} />
      </div>
    ) : (
      conversation
    );

  return (
    <AppShell
      titleBar={titleBar}
      rail={rail}
      {...(view === 'files'
        ? {
            filesPanel: (
              <ZoneTree
                nodes={nodes}
                {...(selectedNodeId ? { selectedId: selectedNodeId } : {})}
                footnote={shellTreeFootnote}
                onSelect={openFile}
                onOpen={openFile}
              />
            ),
          }
        : {})}
      {...(detailPanel ? { detailPanel } : {})}
      statusLine={statusLine}
    >
      {main}
    </AppShell>
  );
}

/** Demo project. Comes from `project` on the hub as soon as that table exists — see HANDOFF §9.2. */
const PROJECT_NAME = 'Хайтейл';

/**
 * Copy without asserting success.
 *
 * `navigator.clipboard` rejects when the document is not focused, which happens routinely in
 * Electron the moment a panel steals focus mid-click. Swallowing that is correct here — the code is
 * also on screen and selectable — but claiming a copy that did not happen would not be.
 */
function copyToClipboard(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/* ------------------------------------------------------------------ *
 * The team — the one part of this page that is not a fixture
 * ------------------------------------------------------------------ */

interface TeamState {
  members: readonly ProjectMember[];
  invites: readonly InviteRecord[];
  state: 'ready' | 'loading' | 'error';
  reload: () => void;
  /** Composer state for the invite panel. */
  channel: InviteChannel;
  setChannel: (channel: InviteChannel) => void;
  email: string;
  setEmail: (email: string) => void;
  role: ProjectRole;
  setRole: (role: ProjectRole) => void;
  lifetime: InviteLifetime;
  setLifetime: (lifetime: InviteLifetime) => void;
  seats: InviteSeats;
  setSeats: (seats: InviteSeats) => void;
  code: string | null;
  link: string | null;
  sending: boolean;
  error: string | null;
  send: () => void;
  rotate: () => void;
  revoke: (invite: InviteRecord) => void;
}

/**
 * Team and invitations, live against `partycod`.
 *
 * Two behaviours worth stating. A failed *read* degrades the panel to its error state and keeps the
 * app running — the shell is not a client of the team list. A failed *write* surfaces the hub's own
 * Russian sentence, because the hub already refuses in words a person can act on («На эту почту уже
 * есть аккаунт», «Слишком много попыток»), and paraphrasing them here would only make them worse.
 */
function useTeam(session: HubSession): TeamState {
  const [members, setMembers] = useState<readonly ProjectMember[]>([]);
  const [raw, setRaw] = useState<readonly HubInvite[]>([]);
  const [state, setState] = useState<'ready' | 'loading' | 'error'>('loading');
  const [nonce, setNonce] = useState(0);

  const [channel, setChannel] = useState<InviteChannel>('email');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('member');
  const [lifetime, setLifetime] = useState<InviteLifetime>('day');
  const [seats, setSeats] = useState<InviteSeats>('five');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manages = canManageInvites(session.member);

  useEffect(() => {
    let cancelled = false;
    setState('loading');

    // The invitation list is only readable by somebody who may hand out seats; asking for it as an
    // observer would be a 403 that turns the whole panel red for no reason.
    void Promise.all([
      hubMembers(session.hubUrl, session.token),
      manages ? hubInvites(session.hubUrl, session.token) : Promise.resolve([] as HubInvite[]),
    ])
      .then(([memberRows, inviteRows]) => {
        if (cancelled) return;
        setMembers(memberRows.map((m) => toProjectMember(m, session.member.id)));
        setRaw(inviteRows);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [session.hubUrl, session.token, session.member.id, manages, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Recomputed on every clock tick the page already has, so «ещё 21 час» does not go stale while
  // the panel is open. `Date.now()` is read here rather than stored: an invitation's remaining time
  // is a function of now, not a value that was true when the response arrived.
  const invites = useMemo(() => {
    const now = Date.now();
    return raw.map((invite) => toInviteRecord(invite, now));
  }, [raw]);

  /** The newest live code, if the team has one — what the «По коду» tab shows. */
  const liveCode = useMemo(
    () => raw.find((i) => i.channel === 'code' && i.status === 'pending' && i.code) ?? null,
    [raw],
  );

  const send = useCallback(() => {
    setSending(true);
    setError(null);
    void hubCreateInvite(session.hubUrl, session.token, {
      role,
      ...(channel === 'email' ? { email } : {}),
      lifetime,
      seats: channel === 'email' ? 'one' : seats,
    })
      .then(() => {
        setEmail('');
        reload();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось создать приглашение.');
      })
      .finally(() => setSending(false));
  }, [session.hubUrl, session.token, role, channel, email, lifetime, seats, reload]);

  const rotate = useCallback(() => {
    // "Change the code" is: revoke the live one, then mint a fresh one. The hub has no rotate
    // endpoint on purpose — an old code must stop admitting people the instant a new one exists,
    // and two statements in that order are easier to reason about than one that does both.
    setSending(true);
    setError(null);
    const previous = liveCode?.code;
    void (previous ? hubRevokeInvite(session.hubUrl, session.token, previous) : Promise.resolve())
      .then(() =>
        hubCreateInvite(session.hubUrl, session.token, { role, lifetime, seats }),
      )
      .then(() => reload())
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось сменить код.');
      })
      .finally(() => setSending(false));
  }, [session.hubUrl, session.token, liveCode, role, lifetime, seats, reload]);

  const revoke = useCallback(
    (invite: InviteRecord) => {
      if (!invite.code) return;
      void hubRevokeInvite(session.hubUrl, session.token, invite.code)
        .then(() => reload())
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'Не удалось отменить приглашение.');
        });
    },
    [session.hubUrl, session.token, reload],
  );

  return {
    members,
    invites,
    state,
    reload,
    channel,
    setChannel,
    email,
    setEmail,
    role,
    setRole,
    lifetime,
    setLifetime,
    seats,
    setSeats,
    code: liveCode?.code ?? null,
    link: liveCode?.joinUrl ?? null,
    sending,
    error,
    send,
    rotate,
    revoke,
  };
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

/**
 * Scaffolding, and labelled as such.
 *
 * The designer moved theme and density out of the title bar («это настройка, а не инструмент») and
 * pointed the empty conversation at «Позвать команду — в настройках», which makes settings a place
 * the product now depends on — but the settings screen itself is the next thing to be drawn, not
 * something this revision shipped. So this is the smallest surface that keeps those two promises
 * and invents nothing: the two switches that lost their old home, the door to the team, and the
 * sign-out. When the design arrives it replaces this file, not the components.
 */
function SettingsView({
  self,
  memberCount,
  onOpenTeam,
  onSignOut,
}: {
  self: ProjectMember;
  memberCount: number;
  onOpenTeam: () => void;
  onSignOut: () => void;
}): React.ReactElement {
  const { theme, density, toggleTheme, setDensity } = useTheme();

  return (
    <div className={styles.settings}>
      <div className={styles.settingsColumn}>
        <h1 className={styles.settingsTitle}>Настройки</h1>
        <p className={styles.settingsLead}>
          Эта страница ещё не нарисована — здесь только то, что переехало из титлбара, и дверь в
          команду. Провайдеры и остальное появятся следующим заходом дизайна.
        </p>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Вид</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Тема</span>
            <button type="button" className={styles.rowAction} onClick={toggleTheme}>
              {theme === 'dark' ? 'Тёмная' : 'Светлая'}
            </button>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Плотность строк</span>
            <button
              type="button"
              className={styles.rowAction}
              onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
            >
              {density === 'comfortable' ? 'Просторная' : 'Плотная'}
            </button>
          </div>
        </section>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Команда</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>
              {memberCount > 0 ? `${memberCount} в проекте` : 'Кто в проекте'}
            </span>
            <button type="button" className={styles.rowAction} onClick={onOpenTeam}>
              Открыть
            </button>
          </div>
        </section>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Аккаунт</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>
              {self.name} · @{self.handle}
            </span>
            <button type="button" className={styles.rowAction} onClick={onSignOut}>
              Выйти
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
