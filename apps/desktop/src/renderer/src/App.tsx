import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  FirstRun,
  LocaleProvider,
  SignInScreen,
  ThemeProvider,
  avatarStyle,
  initialsOf,
  useT,
  useTheme,
  type AuthMode,
  type Dictionary,
  type Lang,
  type AuthSubmit,
  type FirstRunCopyInput,
  type FirstRunKeySubmit,
  type FirstRunProvider,
  type FirstRunStep,
} from '@partyco/ui';
import { Icon } from '@partyco/icons';
import {
  DEFAULT_HUB_URL,
  HubError,
  login as hubLogin,
  logout as hubLogout,
  me as hubMe,
  readStoredSession,
  register as hubRegister,
  storeSession,
  type HubSession,
} from './hub.ts';
import type { LocalHubReady } from './bridge.d.ts';
import { ShellPage } from './pages/Shell.tsx';
import { WORKSPACE_UNAVAILABLE, useWorkspace, type WorkspaceHandle } from './workspace.ts';
import styles from './App.module.css';

/**
 * The chosen language, read synchronously so the first paint is already in it.
 *
 * `localStorage`, not the main process, and the difference is a frame. The theme is asked for over
 * IPC because only the OS knows it; the language is the person's own answer, and routing it through
 * an async bridge would mean painting Russian and correcting it — which is exactly the flash the
 * theme code goes out of its way to avoid.
 *
 * The first launch has no answer, so the browser's own preference decides: somebody whose system is
 * English should not have to find a switch to read the first screen. Anything that is not Russian
 * gets English, because those are the two languages that exist — a Polish system is better served by
 * the one it is more likely to read than by the one it certainly cannot.
 */
const LANG_KEY = 'partyco.lang';

function readStoredLang(): Lang {
  try {
    const stored = window.localStorage.getItem(LANG_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
  } catch {
    // A locked-down partition must not stop the window from rendering.
  }
  try {
    return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  } catch {
    return 'ru';
  }
}

export function App(): ReactElement | null {
  // The OS preference decides the first paint so the window does not flash the wrong theme.
  const [initialTheme, setInitialTheme] = useState<'dark' | 'light' | null>(null);

  const [lang, setLangState] = useState<Lang>(readStoredLang);

  const setLang = useCallback((next: Lang): void => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      // Losing the preference is survivable; refusing to switch because it cannot be saved is not.
    }
  }, []);

  /**
   * Started here, beside the theme, and not deeper down where it is used.
   *
   * Both answers are needed before anything can be drawn — which theme, and whether there is a
   * folder — and asking for them one after another is precisely what turns one blank moment into a
   * cascade of placeholder screens. Two requests, one wait.
   */
  const workspace = useWorkspace();

  useEffect(() => {
    let cancelled = false;
    void window.partyco
      ?.nativeTheme()
      .then((t) => {
        if (!cancelled) setInitialTheme(t);
      })
      .catch(() => {
        if (!cancelled) setInitialTheme('dark');
      });
    // Running in a plain browser (no preload) — fall back rather than hang on a blank window.
    if (!window.partyco) setInitialTheme('dark');
    return () => {
      cancelled = true;
    };
  }, []);

  // The one loading state. It paints nothing rather than a spinner: both answers arrive within a
  // frame or two of local IPC, and a spinner that appears and vanishes reads as a fault.
  if (initialTheme === null || workspace.state === 'loading') return null;

  return (
    <ThemeProvider theme={initialTheme}>
      <LocaleProvider lang={lang} onLangChange={setLang}>
        <Gate workspace={workspace} />
      </LocaleProvider>
    </ThemeProvider>
  );
}

/**
 * The gate — which is, for one person on one machine, no gate at all.
 *
 * Identity in PartyCo comes from a hub and nowhere else, and that has not changed. What changed is
 * who has to build one. The product used to open on a sign-in form for a server the newcomer had not
 * been told to start, which made the first screen a dead end for everybody except the person who had
 * already read the README — a fine price for a team of five, and the entire experience for anybody
 * evaluating it alone.
 *
 * So there are two ways in, tried in this order, and the order is the argument:
 *
 *  1. **A session the member chose.** Stored from a real sign-in against a real hub — theirs or
 *     their team's. It wins outright, because it is the only one that represents a decision. A
 *     member who joined a team hub must not be silently returned to their private one.
 *  2. **The hub this machine runs for itself.** Started by the main process, minted without a
 *     password because the process that owns the database file has nothing to prove — the argument
 *     is in `apps/hub/src/local.js`, and it is worth reading before touching this.
 *
 * The sign-in form is still here and still real; it is simply no longer the front door. It is what
 * «Работать командой» opens, and what the local path falls back to when there is no bridge to raise
 * a hub with — `npm run dev:web` in a browser tab, where nothing can start a server.
 *
 * A stored session is trusted for the first paint and verified against the hub straight after, so a
 * revoked or expired token drops the человек back to the panel instead of showing an app that cannot
 * do anything. If the hub is simply unreachable we keep the session: a dead server is not a logout.
 */

/**
 * The local grant, in the shape the rest of the renderer already speaks.
 *
 * `role` is the one field that needs checking rather than casting. The hub types it as a plain
 * string across the process boundary, `HubSelf` narrows it to the four the product knows, and the
 * gap between those two is exactly where a fifth role would enter the UI without a type error. It
 * cannot happen today — the local member is always `owner` — which is why the guard is cheap now and
 * would be archaeology later.
 */
function asHubSession(url: string, grant: LocalHubReady['session']): HubSession | null {
  const { role } = grant.member;
  if (role !== 'owner' && role !== 'maintainer' && role !== 'member' && role !== 'observer') {
    return null;
  }
  return {
    token: grant.token,
    expiresAt: grant.expiresAt,
    member: { ...grant.member, role },
    hubUrl: url,
    kind: 'local',
  };
}

/** Where the local path can be in its lifetime. `null` means "not asked yet". */
type LocalHub = { state: 'starting' } | { state: 'failed'; reason: string } | { state: 'absent' };

/**
 * What the sign-in panel says when the folder outlived the session.
 *
 * Two facts and one action, in that order: the account is closed, the folder is not, and here is
 * the one thing that changes it. It names the conversation explicitly — «рабочая папка» sounds like
 * a preference, and what actually stayed behind is somebody's correspondence.
 *
 * The underlying sentence from the main process is appended by the caller in brackets: «файл занят
 * другим процессом» is the difference between a person who tries again and a person who gives up.
 */
const FOLDER_KEPT =
  'Из аккаунта ты вышел, но забыть рабочую папку не удалось — она осталась выбранной на этом ' +
  'компьютере вместе с историей разговора в ней. Если за компьютером работает кто-то ещё, войди ' +
  'снова и выбери другую папку: прежняя перестанет быть выбранной.';

function Gate({ workspace }: { workspace: WorkspaceHandle }): ReactElement | null {
  const t = useT();
  const [session, setSession] = useState<HubSession | null>(readStoredSession);
  const [mode, setMode] = useState<AuthMode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Whether the member asked for the sign-in form on purpose.
   *
   * Separate from "there is no session", because those stopped being the same question. Without a
   * session the answer is the local hub; the form appears only when somebody chose it — «Работать
   * командой» — or when the local path has no way to work.
   */
  const [wantsHub, setWantsHub] = useState(false);

  /** `null` until the first answer arrives — the one state where nothing may be painted yet. */
  const [local, setLocal] = useState<LocalHub | null>(null);

  /*
   * Raise the local hub, unless a chosen session already answers the question.
   *
   * Not run when `session` is set: a member signed into their team's hub has no use for a private
   * one, and starting it anyway would open a database and bind a port for a screen nobody will see.
   */
  useEffect(() => {
    if (session) return;
    const bridge = window.partyco;
    if (!bridge) {
      // A browser tab. Nothing here can start a server, so the honest fallback is the form that
      // asks for one somebody else started.
      setLocal({ state: 'absent' });
      return;
    }

    let cancelled = false;
    setLocal({ state: 'starting' });
    void bridge
      .localHub()
      .then((answer) => {
        if (cancelled) return;
        if (answer.status === 'failed') {
          setLocal({ state: 'failed', reason: answer.reason });
          return;
        }
        const next = asHubSession(answer.url, answer.session);
        if (!next) {
          setLocal({ state: 'failed', reason: t.localHub.roleUnknown });
          return;
        }
        /*
         * Deliberately not stored. The main process mints this session at every launch against a
         * hub whose port the OS picks fresh, so a copy in `localStorage` would be a token for a
         * server that no longer exists — and it would outrank the live one on the next start, since
         * a stored session wins. What persists is the member row in `hub.db`, which is the part that
         * should.
         */
        setSession(next);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLocal({
          state: 'failed',
          reason: cause instanceof Error ? cause.message : t.localHub.unreachable,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void hubMe(session.hubUrl, session.token)
      .then((member) => {
        if (!cancelled) setSession((current) => (current ? { ...current, member } : current));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Only an actual refusal signs the member out. Anything else — server down, laptop offline —
        // leaves them where they were.
        if (cause instanceof HubError && cause.status === 401) {
          storeSession(null);
          setSession(null);
          setError('Сессия истекла — войди заново.');
        }
      });
    return () => {
      cancelled = true;
    };
    // Runs once per session identity; re-verifying on every render would hammer the hub.
  }, [session?.token, session?.hubUrl]);

  /**
   * Switching Вход ⇄ Регистрация, and dropping the hub's last answer on the way.
   *
   * `AuthPanel` states plainly that it will not clear `error` by itself — it cannot know whether the
   * message still applies — and hands that duty to the caller's `onModeChange`. Passing `setMode`
   * bare skipped it, so a failed sign-in left «Неверная почта или пароль.» in red under a
   * «Создать аккаунт» button nobody had pressed: a verdict on an action that had not happened.
   */
  const changeMode = useCallback((next: AuthMode): void => {
    setMode(next);
    setError(null);
  }, []);

  const submit = useCallback((input: AuthSubmit): void => {
    setBusy(true);
    setError(null);
    const run =
      input.mode === 'register'
        ? hubRegister(input.hubUrl, {
            email: input.email,
            password: input.password,
            ...(input.displayName ? { displayName: input.displayName } : {}),
          })
        : hubLogin(input.hubUrl, { email: input.email, password: input.password });

    void run
      .then((next) => {
        // Stored, unlike the local session: this one is a decision, and a decision has to survive a
        // restart or the member makes it again every launch.
        storeSession(next);
        setSession(next);
        setWantsHub(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось связаться с хабом.');
      })
      .finally(() => setBusy(false));
  }, []);

  const signOut = useCallback(
    (current: HubSession): void => {
      // The session goes first, and synchronously. Everything after this line is cleanup; a member
      // who pressed «Выйти» is out of their account before any of it can fail or hang.
      storeSession(null);
      setSession(null);
      setMode('login');
      setError(null);
      // Best effort: the local session is already gone, so a failed round-trip changes nothing here.
      void hubLogout(current.hubUrl, current.token).catch(() => undefined);

      /*
       * **Signing out forgets the working folder**, and the reason is privacy rather than tidiness.
       *
       * The conversation is stored per folder. A folder that outlives the member who chose it hands
       * the next person to sign in on this machine an opened project *and the correspondence inside
       * it* — with no first run, no folder picker, nothing that would have told them whose it was
       * or told its owner that it had been handed over. One extra click on the next launch is a
       * cheaper thing to pay than that.
       *
       * `unavailable` is the one case with nothing to forget: this window never had a bridge, so no
       * folder was ever read into it (the browser preview, or a preload that failed to load). Asking
       * anyway would only produce a warning about a leak that cannot exist.
       */
      /*
       * **And it forgets the provider keys**, by the same argument, which only became necessary
       * when the keys stopped being forgotten by themselves.
       *
       * They used to live in the main process's memory and die with it, so quitting was the cleanup.
       * Now they are encrypted on disk and survive a restart — which is what a member asked for, and
       * which turns the shared-machine case into a real leak: DPAPI protects the key from another
       * *Windows* account, not from the next PartyCo member sitting at the same one. Inheriting
       * somebody's paid key and spending their limit under your own name is worse than retyping it.
       *
       * Best effort, and deliberately not awaited before the session is gone: this runs after the
       * member is already out. `keyStatus` first, so a member with no keys is not charged a
       * round-trip per provider for nothing.
       */
      const keys = window.partyco?.agents;
      if (keys) {
        void keys
          .keyStatus()
          .then((report) => {
            if (!report.ok) return;
            for (const key of report.value.keys) {
              if (key.hasKey) void keys.setKey(key.providerId, '').catch(() => undefined);
            }
          })
          .catch(() => undefined);
      }

      if (workspace.state === 'unavailable') return;
      void workspace.clear().then((result) => {
        /*
         * Said on the sign-in panel because that is the only screen left. The member is out of the
         * app — there is no settings page to put this on and no toast that would outlive the
         * unmount — and staying quiet would leave the one person who could act on it (close the
         * app, choose a different folder next time) unaware that the folder is still there.
         */
        if (!result.ok) setError(`${FOLDER_KEPT} (${result.error})`);
      });
    },
    [workspace],
  );

  /*
   * The one moment nothing may be painted: the local hub has been asked and has not answered.
   *
   * It resolves in the tens of milliseconds a loopback bind and an SQLite open take, so a spinner
   * would appear and vanish — and the alternative, flashing the sign-in form first, would show a
   * person a question that is about to answer itself.
   */
  if (!session && (local === null || local.state === 'starting')) return null;

  if (!session || wantsHub) {
    /*
     * Two different screens wearing the same component.
     *
     * Without a session this is a failure report: the local hub could not start, and the form is the
     * remaining way in — somebody else's hub, if the member has one. With a session it is a
     * deliberate move to a team hub, opened from «Меня позвали в проект команды».
     *
     * `error` from a failed submit outranks the local reason, because it is newer and it is about
     * the thing the member just did.
     */
    const localReason = !session && local?.state === 'failed' ? local.reason : null;

    // `SignInScreen` centres itself in the window and carries the mark, the sub-line and the
    // guarantee about provider keys — the gate wrapper it used to need is part of it now.
    return (
      <Door>
        <SignInScreen
          mode={mode}
          onModeChange={changeMode}
          onSubmit={submit}
          busy={busy}
          error={error ?? localReason}
          hubUrl={DEFAULT_HUB_URL}
        />
      </Door>
    );
  }

  return (
    <Product
      onJoinTeam={() => {
        setError(null);
        setWantsHub(true);
      }}
      /*
       * A fresh `Product` per member, and the key is the point rather than a React formality.
       *
       * `keyAnswered` is seeded once, at mount, from whether a folder already existed — which is the
       * right question to ask about *a member who has been here before* and the wrong one to inherit
       * from somebody else. Keying on the member id makes «this run» mean the run of this person:
       * the second member on a shared machine gets their own first run, and its greeting says their
       * name, because the component that holds that state is a different component.
       *
       * The sign-out path already unmounts `Product` (no session, no product), so on that route
       * this is belt to braces. It is here for every route that does not pass through `null` —
       * a stored session replaced, a token swapped underneath — where the unmount would not happen.
       */
      key={session.member.id}
      session={session}
      workspace={workspace}
      onSignOut={() => signOut(session)}
    />
  );
}

/* ------------------------------------------------------------------ *
 * First run
 * ------------------------------------------------------------------ */

/**
 * What step 2 says when the provider half of the bridge is missing.
 *
 * A separate sentence from `WORKSPACE_UNAVAILABLE` on purpose: the two failures share a cause but
 * not a consequence, and a message that names the wrong action is a message a person cannot act on.
 */
const AGENTS_UNAVAILABLE =
  'Приложение не смогло связаться со своей системной частью, поэтому сохранить ключ сейчас нельзя. ' +
  'Пропусти шаг — ключ можно добавить позже в настройках; если это повторится, переустанови PartyCo.';

/**
 * The footnote of step 1, with one sentence added to the designer's.
 *
 * «Меня позвали в проект команды» used to open the same folder picker as the primary button, and the
 * footnote's job was to admit it before the click. It now opens the hub sign-in, which is the thing
 * the button always claimed — so the sentence stopped being an apology and became a description.
 *
 * What it still refuses to promise is the repository: joining a team means an account on their hub
 * and a seat in their project, and the shared repository behind it does not exist yet. Saying so
 * here is cheaper than a person discovering it after signing up.
 */
function firstRunCopy(t: Dictionary): FirstRunCopyInput {
  const c = t.firstRun;
  return {
    region: c.region,
    heading: c.heading,
    // The braces are filled by `FirstRun` itself — see the note on `progress` in `ru.ts`.
    progress: c.progress('{step}', '{total}'),
    statusRegion: c.statusRegion,
    folder: {
      title: c.folder.title('{name}'),
      titleAnonymous: c.folder.titleAnonymous,
      body: c.folder.body,
      primary: c.folder.primary,
      secondary: c.folder.secondary,
      footnote: c.folder.footnote,
    },
    key: {
      title: c.key.title,
      body: c.key.body,
      providerGroup: c.key.providerGroup,
      field: c.key.field,
      primary: c.key.primary,
      busy: c.key.busy,
      skip: c.key.skip,
      whyDisabled: c.key.whyDisabled,
      noProviders: c.key.noProviders,
      // `guarantee` is deliberately absent: it is the keychain promise, and `FirstRun`'s own default
      // is the reviewed wording. Overriding it here would fork one sentence into two owners.
    },
  };
}

/**
 * What the product is once somebody is signed in: first run, or the shell.
 *
 * The order is the argument. Until there is a folder there is nothing to be inside of, so the
 * shell is not rendered «with empty panels» — it is not rendered at all. The two steps are the
 * whole setup, both skippable, and neither of them asks anything the product cannot yet act on.
 */
function Product({
  session,
  workspace,
  onSignOut,
  onJoinTeam,
}: {
  session: HubSession;
  workspace: WorkspaceHandle;
  onSignOut: () => void;
  /** Opens the hub sign-in. Owned by the gate, because the gate is what decides who is signed in. */
  onJoinTeam: () => void;
}): ReactElement {
  /**
   * Whether the key question has been dealt with in this run.
   *
   * Seeded from the folder: a member who already has one is a member who has been here before, and
   * asking them for a key on every launch would make the wizard the product. Only the walk-through
   * that just chose a folder gets step 2.
   */
  const t = useT();
  const [keyAnswered, setKeyAnswered] = useState(() => workspace.workspace !== null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  /*
   * `unavailable` means the question cannot be asked — there is no bridge in this window, so no
   * picker can open. In development that is the browser preview (`dev:web`) or an Electron build
   * whose preload does not carry the workspace bridge yet; the scaffolding has to keep working, so
   * first run steps aside. In a packaged build the same state is a broken installation, and the
   * honest answer is step 1 with the reason written on it — never a shell pretending to look at a
   * folder it cannot name.
   */
  const unavailable = workspace.state === 'unavailable';
  const step: FirstRunStep | null =
    unavailable && import.meta.env.DEV ? null : workspace.workspace === null ? 1 : keyAnswered ? null : 2;

  const providers = useFirstRunProviders(step === 2);

  /** The key crosses the bridge and is not kept here — see `AgentsBridge.setKey`. */
  const saveKey = ({ providerId, key }: FirstRunKeySubmit): void => {
    const agents = window.partyco?.agents;
    if (!agents) {
      // Not `WORKSPACE_UNAVAILABLE`: that sentence ends «поэтому выбрать папку сейчас нельзя», and
      // printing it under the key field would name an action the member is not performing. Same
      // cause, different casualty — so it says which one.
      setKeyError(AGENTS_UNAVAILABLE);
      return;
    }
    setKeyBusy(true);
    setKeyError(null);
    void agents
      .setKey(providerId, key)
      .then((result) => {
        if (!result.ok) {
          setKeyError(result.error);
          return;
        }
        setKeyAnswered(true);
      })
      .catch((cause: unknown) => {
        setKeyError(cause instanceof Error ? cause.message : 'Не удалось сохранить ключ.');
      })
      .finally(() => setKeyBusy(false));
  };

  if (step !== null) {
    const chooseFolder = (): void => {
      void workspace.choose();
    };
    const message = step === 2 ? keyError : unavailable ? WORKSPACE_UNAVAILABLE : workspace.error;

    return (
      <Door>
        <FirstRun
          step={step}
          userName={session.member.displayName}
          onChooseFolder={chooseFolder}
          // The hub sign-in, which is what this button has always said it was: see firstRunCopy.
          onJoinTeam={onJoinTeam}
          providers={providers}
          /*
           * The panel keeps the choice itself — no `providerId` is passed — so this exists only to
           * drop the previous refusal. `agents.setKey` answers with the vendor's own complaint about
           * the key it was given; leaving «ключ отклонён» under a different provider's field states
           * something no one has checked.
           */
          onProviderChange={() => setKeyError(null)}
          onSaveKey={saveKey}
          onSkip={() => setKeyAnswered(true)}
          busy={step === 2 ? keyBusy : workspace.busy}
          error={message}
          copy={firstRunCopy(t)}
        />
      </Door>
    );
  }

  return (
    <ShellPage
      session={session}
      workspace={workspace}
      onSignOut={onSignOut}
      onJoinTeam={onJoinTeam}
    />
  );
}

/**
 * The providers offered on the key step, from the vendor-policy catalogue rather than from a list
 * written into the interface.
 *
 * Two reasons. The catalogue is what `agents.setKey` is checked against, so a provider drawn here
 * is by construction a provider whose key the main process will accept. And the API-key path is not
 * allowed for every vendor — the catalogue is where that is recorded, with the vendor's own
 * citation — so a `prohibited` direct-api transport drops out instead of being offered a field that
 * would only be refused later.
 *
 * Failure is not fatal: `undefined` leaves `FirstRun` with its own defaults, which is the same list
 * one layer less true.
 */
function useFirstRunProviders(enabled: boolean): readonly FirstRunProvider[] | undefined {
  const [providers, setProviders] = useState<readonly FirstRunProvider[] | undefined>(undefined);

  useEffect(() => {
    const agents = window.partyco?.agents;
    if (!enabled || !agents) return;

    let cancelled = false;
    // `policy()` is pure data — no process is started and no credential is touched, unlike
    // `detect()`, which is why the setup screen is not reused here.
    void agents
      .policy()
      .then((result) => {
        if (cancelled || !result.ok) return;
        setProviders(
          result.value.providers
            .filter((provider) => {
              const direct = provider.transports.find((t) => t.transport === 'direct-api');
              // A provider with no `direct-api` entry at all has no API-key path — the catalogue
              // simply does not describe one. `?.status !== 'prohibited'` used to let it through,
              // because `undefined !== 'prohibited'`, and offered a key field for a transport that
              // does not exist. Absence is not permission.
              if (!direct) return false;
              // The two statuses `POLICY_SELECTABLE` marks false. Repeated here as literals rather
              // than imported: `@partyco/agents` is a main-process package and its barrel reaches
              // `engine.ts`, i.e. `node:child_process` — pulling that into web content to read one
              // lookup table would be a far worse trade than two words. `AgentPolicyCatalog` types
              // `status`, so a typo in either is a build error, not a silently empty filter.
              return direct.status !== 'prohibited' && direct.status !== 'requires-approval';
            })
            .map((provider) => ({
              id: provider.id,
              label: provider.label,
              glyph: provider.label.slice(0, 1),
              keyHint: provider.apiKeyHint,
            })),
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return providers;
}

/* ------------------------------------------------------------------ *
 * Window chrome
 * ------------------------------------------------------------------ */

/**
 * The screens before the shell — sign-in and first run — inside the window strip they need.
 *
 * The window is frameless: `titleBarStyle: 'hidden'` with a 36px `titleBarOverlay` on Windows, so
 * the OS paints its three buttons over the top of whatever is there and nothing is draggable unless
 * the page says so. The shell has `ShellTitleBar` for that; these two screens have no title bar of
 * their own, and without this strip the window could not be moved at all while somebody signs in.
 *
 * It is also what the export draws: screen 01 opens with a 34px bar carrying the mark, the product
 * name and 140px kept clear on the right for the system buttons.
 */
function Door({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className={styles.root}>
      <header className="pc-titlebar">
        <span className={styles.brand} aria-hidden>
          <span className={styles.mark} />
          PartyCo
        </span>
        {/* Where the OS draws minimise/maximise/close. Ours to keep empty, not to fill. */}
        <span className={styles.controlsReserve} aria-hidden />
      </header>
      <div className={styles.doorBody}>{children}</div>
    </div>
  );
}
