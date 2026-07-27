import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppShell,
  Composer,
  ContextRail,
  Conversation,
  EventCard,
  FileViewer,
  InvitePanel,
  ProviderSetup,
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
  type ShellStatus,
  type ShellView,
  type ZoneTreeNode,
} from '@partyco/ui';
import {
  canManageInvites,
  toInviteRecord,
  toProjectMember,
  toProjectRosterMember,
} from '../present.ts';
import { useProviderLayer } from '../providers.ts';
import { pathOfRow, useFileTree, useOpenFile } from '../files.ts';
import { useConversation } from '../conversation.ts';
import { useProjects, type ProjectsModel } from '../projects.ts';
import type { WorkspaceHandle } from '../workspace.ts';
import {
  createInvite as hubCreateInvite,
  invites as hubInvites,
  members as hubMembers,
  projectMembers as hubProjectMembers,
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
 * conversation, the state fields that are actually known, three avatars in the corner. Everything
 * else arrives because somebody asked for it, and leaves again when they close it.
 *
 * **Every value on this page is a real one.** The team and its invitations come from `partycod`;
 * the files come from the folder the member picked; the conversation is on disk and the agent that
 * wrote it was a real child process. Where a subsystem does not exist yet — zones, the merge gate,
 * the trunk's health, what the day cost — the surface says so and shows nothing, because a
 * plausible number is worse than a gap: a person who believes «Ствол здоров» when nothing checked
 * the trunk has been misled by their own tool. The empty states are not placeholders waiting to be
 * filled with fixtures; they are the correct answer until the roadmap reaches them.
 */

/** What may occupy the slide-out panel on the right. Nothing, by default and after every close. */
type Detail = 'team' | 'invite' | null;

export function ShellPage({
  session,
  workspace,
  onSignOut,
}: {
  session: HubSession;
  workspace: WorkspaceHandle;
  onSignOut: () => void;
}): React.ReactElement {
  const [view, setView] = useState<ShellView>('conversation');
  const [detail, setDetail] = useState<Detail>(null);
  const [statusExpanded, setStatusExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [ownershipTab, setOwnershipTab] = useState<OwnershipTab>('zones');

  const projects = useProjects(session);
  const team = useTeam(session, projects.current?.id ?? null);
  const self = useMemo(
    () => toProjectMember(session.member, session.member.id),
    [session.member],
  );

  const folder = workspace.workspace;
  const providers = useProviderLayer();
  const files = useFileTree(folder);
  const open = useOpenFile(folder);
  const talk = useConversation(folder, self, providers.providers, providers.state === 'ready');
  const status = useShellStatus(team.state);

  /* ---------- the files panel ---------- */

  // Filtering happens over the rows already read, and the footnote says so. Searching a repository
  // properly means walking it, which is the main process's job and not written yet — pretending
  // otherwise would leave a person concluding a file does not exist because its folder is shut.
  const filtered = useMemo<readonly ZoneTreeNode[]>(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return files.nodes;
    return files.nodes.filter(
      (node) => node.kind === 'file' && node.label.toLowerCase().includes(needle),
    );
  }, [files.nodes, search]);

  const activate = useCallback(
    (node: ZoneTreeNode) => {
      files.select(node.id);
      if (node.kind === 'file') open.open(pathOfRow(node.id));
      else files.toggle(pathOfRow(node.id));
    },
    [files, open],
  );

  /* ---------- chrome ---------- */

  /**
   * Two different things are called «проект», and the title bar says the one that is shared.
   *
   * The hub's project is what a team has in common — it is where the roster lives and where an
   * invitation lands. The folder is one member's copy on one machine. Until a project exists the
   * folder's name is the honest stand-in, because it is the only name anybody has agreed on.
   */
  const projectName = projects.current?.name ?? folder?.name ?? 'PartyCo';

  const titleBar = (
    <ShellTitleBar
      projectName={projectName}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value);
        // Typing in the title bar is asking to look at files. Leaving the person on the
        // conversation while their query filters a panel they cannot see is a control that
        // appears broken.
        if (value.trim()) setView('files');
      }}
      searchShortcut={['Ctrl', 'K']}
      // The chevron goes to settings rather than opening a popover the designer has not drawn.
      // Everything a person could want from it — switch project, create one, change the folder —
      // is there in full, and inventing a second surface for the same three actions would mean
      // shipping a control nobody designed and then owning both.
      onProjectSwitch={() => {
        setView('settings');
        setDetail(null);
      }}
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
      projectInitial={projectName.slice(0, 1).toUpperCase()}
      onNewTask={() => {
        setView('conversation');
        setDetail(null);
        setDraft('');
      }}
      self={self}
      // A dot is a claim that something is happening. The one thing this shell genuinely knows is
      // whether a child process of its own is running right now.
      presenceTone={talk.running ? 'running' : null}
    />
  );

  const statusLine = (
    <StatusLine
      status={status}
      expanded={statusExpanded}
      onToggleDetails={() => setStatusExpanded((expandedNow) => !expandedNow)}
    />
  );

  /* ---------- the slide-out panel ---------- */

  const detailPanel =
    detail === 'team' ? (
      <TeamPanel
        members={team.members}
        invites={team.invites}
        state={team.state}
        footnote={TEAM_FOOTNOTE}
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
      context={{
        ...(folder ? { zonePath: folder.branch ? `${folder.name} · ${folder.branch}` : folder.name } : {}),
        // «Сначала план», and it is not a setting — it is what this build actually does. PartyCo
        // passes no permission flags to the vendor CLI, and a non-interactive run has nobody to
        // answer a write prompt, so the agent reads the project and answers without editing it.
        // The three modes become a real choice when the engine starts passing the flag.
        mode: 'plan',
        providerId: talk.target?.providerId ?? '',
        modelLabel: talk.target?.label ?? 'нет провайдера',
      }}
      self={self}
      value={draft}
      onValueChange={setDraft}
      onSubmit={(value) => {
        talk.send(value);
        setDraft('');
      }}
      disabled={talk.blocked !== null || talk.running}
      variant={view === 'files' ? 'narrow' : 'wide'}
      copy={{
        ...(talk.blocked ? { placeholder: talk.blocked } : {}),
        ...(view === 'files' && !talk.blocked ? { placeholder: 'Спросить про этот файл…' } : {}),
      }}
      // The chips are facts, not menus, until there is something to choose between: mode selection
      // and model selection are both roadmap items, and a chip that opens nothing is a dead control.
      modeTone="success"
    />
  );

  const conversation = (
    <Conversation
      items={talk.items}
      state={talk.state}
      variant={view === 'files' ? 'narrow' : 'wide'}
      renderEvent={(event) => <EventCard event={event} />}
      onToggleWork={talk.toggleWork}
      onRetry={talk.reload}
      copy={{ empty: greeting(session.member.displayName, talk.blocked) }}
      // What is missing from the top of the ribbon, said where it is missing from. Silence here
      // would make a conversation that starts mid-sentence look like the whole of it.
      {...(talk.omittedEarlierTurns > 0
        ? {
            header: `Показаны последние ходы. Раньше них было ещё ${talk.omittedEarlierTurns} — ` +
              'они на месте, в файле истории, просто не в этом окне.',
          }
        : {})}
      footer={composer}
    />
  );

  const main =
    view === 'ownership' ? (
      <ZoneBoard
        tab={ownershipTab}
        onTabChange={setOwnershipTab}
        // Nothing hands out zones yet and nothing queues a patch, so both tabs are honestly empty.
        // `emptyActions` is left out on purpose: the button under an empty state has to do
        // something, and «Разметить зоны» has nothing to call.
        state="empty"
        meta={OWNERSHIP_META}
        renderQueue={() => null}
      />
    ) : view === 'settings' ? (
      <SettingsView
        self={self}
        memberCount={team.members.length}
        workspace={workspace}
        projects={projects}
        providers={providers}
        onOpenTeam={() => setDetail('team')}
        onSignOut={onSignOut}
      />
    ) : view === 'files' && open.state !== 'empty' ? (
      <div className={styles.split}>
        <div className={styles.narrowColumn}>{conversation}</div>
        <FileViewer
          {...(open.file ? { file: open.file } : {})}
          state={open.state}
          diff={false}
          onClose={open.close}
          onRetry={open.retry}
          {...(open.error
            ? { labels: { errorTitle: 'Файл не показан', errorBody: open.error } }
            : {})}
        />
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
                nodes={filtered}
                state={search.trim() && filtered.length === 0 ? 'empty' : files.state}
                {...(files.selectedId ? { selectedId: files.selectedId } : {})}
                footnote={treeFootnote(
                  files.omittedInTreeTotal,
                  files.unreadableDirs,
                  search.trim() !== '',
                )}
                onSelect={activate}
                onOpen={activate}
                onToggle={(node) => files.toggle(pathOfRow(node.id))}
                onRetry={files.reload}
                labels={{
                  emptyBody: search.trim()
                    ? 'Среди открытых папок такого файла нет. Открой папку в дереве — поиск смотрит только то, что уже прочитано.'
                    : 'Зон ещё нет — проект не поделён. Здесь просто файлы папки, которую ты выбрал.',
                }}
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

/* ------------------------------------------------------------------ *
 * Copy that states what is and is not known
 * ------------------------------------------------------------------ */

const TREE_FOOTNOTE =
  'Цветной кромки пока нет: проект не поделён на зоны, поэтому ничья территория здесь не отмечена.';

const SEARCH_FOOTNOTE = 'Поиск идёт по уже открытым папкам — закрытые он не смотрит.';

/**
 * The line under the file tree, assembled from what is actually missing from it.
 *
 * Three different silences, and each of them looks identical to «здесь ничего нет» if it is not
 * said out loud: a directory whose listing hit the ceiling, a directory that could not be read at
 * all, and a search that only covers what has been opened. A person who cannot find a file has to
 * be able to tell which of those they are looking at — otherwise the honest answer «файла нет»
 * becomes indistinguishable from the tool quietly giving up.
 */
function treeFootnote(
  omittedTotal: number,
  unreadable: ReadonlyMap<string, string>,
  searching: boolean,
): string {
  const parts: string[] = [];

  if (omittedTotal > 0) {
    parts.push(
      `Показано не всё: ${omittedTotal} ${plural(omittedTotal, 'запись', 'записи', 'записей')} ` +
        'в открытых папках не поместились. Ищи по имени или открывай вложенную папку.',
    );
  }

  if (unreadable.size > 0) {
    // One folder gets its own reason; several get a count, because four permission errors stacked
    // under a tree is a wall of text where a number and one example are enough to act on.
    const first = [...unreadable.entries()][0];
    parts.push(
      unreadable.size === 1 && first
        ? `«${first[0] || '/'}» не открылась: ${first[1]}`
        : `${unreadable.size} ${plural(unreadable.size, 'папка', 'папки', 'папок')} не открылись — ` +
          'скорее всего к ним нет доступа. Они остались закрытыми, а не пустыми.',
    );
  }

  parts.push(searching ? SEARCH_FOOTNOTE : TREE_FOOTNOTE);
  return parts.join(' ');
}

/** Russian plural forms. The same three-form rule `present.ts` uses; kept local to avoid a barrel. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const OWNERSHIP_META = 'Границ ещё нет — их раздаёт ядро, а его в этой сборке нет.';

const TEAM_FOOTNOTE =
  'Люди и приглашения — настоящие: они лежат на хабе команды. Зоны и очередь появятся вместе с ядром.';

/**
 * The first thing a person sees in an empty conversation.
 *
 * It uses their real name and, when nothing can run, says what to do instead of greeting them into
 * a composer that will not accept anything.
 */
function greeting(name: string, blocked: string | null): { title: string; body: string } {
  const firstName = name.trim().split(/\s+/)[0] ?? name;
  if (blocked) return { title: `${firstName}, ещё один шаг`, body: blocked };
  return {
    title: `${firstName}, покажи, где лежит код`,
    body: 'Напиши, что нужно сделать. Агент запустится здесь, на этой машине, в папке проекта — и всё, что он сделает, останется в этой ленте.',
  };
}

/**
 * The status line, built only out of what is actually known.
 *
 * Connection is real: the team panel's own read either reached `partycod` or did not, and that is
 * exactly the fact the field reports. Everything else — the trunk, the day's spend, `state_version`,
 * held zones, queue depth — belongs to subsystems that do not exist in this build, so the fields are
 * absent and `StatusLine` omits them along with the «Подробности» disclosure.
 *
 * `latencyLabel` stays empty even though a round-trip to the hub could be timed, because nothing
 * here times it. The branch is not put in that slot either: a field that means «сколько миллисекунд
 * до команды» must not quietly start meaning something else — the branch already has an honest home
 * on the composer's chip.
 */
function useShellStatus(teamState: 'ready' | 'loading' | 'error'): ShellStatus {
  return useMemo(() => {
    if (teamState === 'error') {
      return {
        connection: 'offline',
        offlineNote: 'Хаб команды не отвечает. Работать можно — просто в одиночку.',
      };
    }
    return { connection: 'direct' };
  }, [teamState]);
}

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

/**
 * Projects on the hub: which one this member is in, and the way to make the first.
 *
 * There is no picker popover in the title bar because the designer has not drawn one, and the three
 * things a person wants from it — switch, create, see who is in it — all fit here without inventing
 * a surface. The chevron up in the chrome navigates to this section.
 *
 * The create field is seeded with the folder's name rather than left blank. That is not a guess
 * dressed up as data: it is a suggestion in an input the person edits before pressing anything, and
 * on a first project it is almost always right.
 */
function ProjectSection({
  projects,
  workspace,
}: {
  projects: ProjectsModel;
  workspace: WorkspaceHandle;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const suggested = workspace.workspace?.name ?? '';
  const value = creating ? name : '';

  return (
    <section className={styles.block}>
      <h2 className={styles.blockTitle}>Проект на хабе</h2>

      {projects.state === 'loading' ? (
        <p className={styles.blockNote}>Смотрим, в каких проектах ты состоишь…</p>
      ) : projects.state === 'error' ? (
        <div className={styles.row}>
          <span className={styles.rowLabel}>
            {projects.error ?? 'Хаб не ответил. Работать можно — это только список.'}
          </span>
          <button type="button" className={styles.rowAction} onClick={projects.reload}>
            Ещё раз
          </button>
        </div>
      ) : projects.projects.length === 0 ? (
        <p className={styles.blockNote}>
          Проектов пока нет. Проект — это то, во что можно позвать людей: у него есть состав и роли.
          Создай первый, и приглашения начнут вести именно в него.
        </p>
      ) : (
        projects.projects.map((project) => {
          const current = project.id === projects.current?.id;
          return (
            <div className={styles.row} key={project.id}>
              <span className={styles.rowLabel}>
                {project.name} · {PROJECT_ROLE_WORD[project.role] ?? project.role} ·{' '}
                {project.memberCount === 1 ? 'ты один' : `${project.memberCount} человек`}
              </span>
              {current ? (
                <span className={styles.rowFact}>сейчас открыт</span>
              ) : (
                <button
                  type="button"
                  className={styles.rowAction}
                  onClick={() => projects.select(project.id)}
                >
                  Открыть
                </button>
              )}
            </div>
          );
        })
      )}

      {projects.state === 'ready' ? (
        creating ? (
          <div className={styles.row}>
            <input
              className={styles.rowInput}
              value={value}
              onChange={(event) => setName(event.target.value)}
              placeholder="Название проекта"
              aria-label="Название нового проекта"
              autoFocus
            />
            <button
              type="button"
              className={styles.rowAction}
              disabled={projects.busy || value.trim() === ''}
              onClick={() => {
                void projects.create(value.trim()).then((created) => {
                  if (created) {
                    setCreating(false);
                    setName('');
                  }
                });
              }}
            >
              {projects.busy ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        ) : (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Новый проект</span>
            <button
              type="button"
              className={styles.rowAction}
              onClick={() => {
                setName(suggested);
                setCreating(true);
              }}
            >
              Создать
            </button>
          </div>
        )
      ) : null}

      {creating && projects.error ? <p className={styles.blockNote}>{projects.error}</p> : null}
    </section>
  );
}

/** The role in words, because `maintainer` is a table value and not something a person says. */
const PROJECT_ROLE_WORD: Record<string, string> = {
  owner: 'ты владелец',
  maintainer: 'ты мейнтейнер',
  member: 'ты участник',
  observer: 'ты наблюдатель',
};

/* ------------------------------------------------------------------ *
 * The team
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
function useTeam(session: HubSession, projectId: string | null): TeamState {
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

    // Two different rosters, and which one is right depends on whether a project exists yet. With
    // one, «команда» means the people in that project — the smaller, truer answer. Without one it
    // can only mean everybody on the hub, and saying so is better than showing an empty panel to a
    // member who has colleagues.
    const roster: Promise<readonly ProjectMember[]> = projectId
      ? hubProjectMembers(session.hubUrl, session.token, projectId).then((answer) =>
          // `toProjectRosterMember`, not `toProjectMember`: inside a project the role that matters
          // is the one in the project, and the two are frequently different.
          answer.members.map((m) => toProjectRosterMember(m, session.member.id)),
        )
      : hubMembers(session.hubUrl, session.token).then((rows) =>
          rows.map((m) => toProjectMember(m, session.member.id)),
        );

    // The invitation list is only readable by somebody who may hand out seats; asking for it as an
    // observer would be a 403 that turns the whole panel red for no reason.
    void Promise.all([
      roster,
      manages ? hubInvites(session.hubUrl, session.token) : Promise.resolve([] as HubInvite[]),
    ])
      .then(([memberRows, inviteRows]) => {
        if (cancelled) return;
        setMembers(memberRows);
        setRaw(inviteRows);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [session.hubUrl, session.token, session.member.id, manages, projectId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // `Date.now()` is read here rather than stored: an invitation's remaining time is a function of
  // now, not a value that was true when the response arrived.
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
      .then(() => hubCreateInvite(session.hubUrl, session.token, { role, lifetime, seats }))
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
 * something this revision shipped. So this is the smallest surface that keeps those promises and
 * invents nothing. When the design arrives it replaces this file, not the components.
 */
function SettingsView({
  self,
  memberCount,
  workspace,
  projects,
  providers,
  onOpenTeam,
  onSignOut,
}: {
  self: ProjectMember;
  memberCount: number;
  workspace: WorkspaceHandle;
  projects: ProjectsModel;
  providers: ReturnType<typeof useProviderLayer>;
  onOpenTeam: () => void;
  onSignOut: () => void;
}): React.ReactElement {
  const { theme, density, toggleTheme, setDensity } = useTheme();

  return (
    <div className={styles.settings}>
      <div className={styles.settingsColumn}>
        <h1 className={styles.settingsTitle}>Настройки</h1>
        <p className={styles.settingsLead}>
          Эта страница ещё не нарисована — здесь только то, что переехало из титлбара, проект, папка
          и провайдеры.
        </p>

        <ProjectSection projects={projects} workspace={workspace} />

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Папка на этой машине</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>
              {workspace.workspace
                ? `${workspace.workspace.name} · ${workspace.workspace.root}`
                : 'Папка не выбрана'}
            </span>
            <button
              type="button"
              className={styles.rowAction}
              onClick={() => void workspace.choose()}
              disabled={workspace.busy}
            >
              Сменить
            </button>
          </div>
          <p className={styles.blockNote}>
            Проект — общий для команды, папка — твоя копия на этом компьютере. Связать их
            по-настоящему сможет только репозиторий на хабе, а его ещё нет: пока это две отдельные
            вещи, и приложение не делает вид, что они одна.
          </p>
        </section>

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

        {/*
          The first surface where the provider layer is real rather than described: what it lists
          comes from the vendor-policy catalogue in `@partyco/agents` and from a PATH scan on this
          machine. A refused transport is drawn refused, with the vendor's own sentence next to it.
        */}
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Провайдеры</h2>
          <ProviderSetup
            providers={providers.providers}
            state={providers.state}
            {...(providers.keysPersisted === undefined
              ? {}
              : { keysPersisted: providers.keysPersisted })}
            busyProviderId={providers.busyProviderId}
            onModeChange={providers.setMode}
            onKeySubmit={providers.submitKey}
            onRedetect={providers.redetect}
            onRetry={providers.redetect}
          />
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
