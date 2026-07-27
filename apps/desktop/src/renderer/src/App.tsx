import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  useTransition,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  FirstRun,
  SignInScreen,
  ThemeProvider,
  avatarStyle,
  initialsOf,
  useTheme,
  type AuthMode,
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
import { CoreStatusPage } from './pages/CoreStatus.tsx';
import { ShellPage } from './pages/Shell.tsx';
import { WORKSPACE_UNAVAILABLE, useWorkspace, type WorkspaceHandle } from './workspace.ts';
import styles from './App.module.css';

/* ------------------------------------------------------------------ *
 * The bench screens — loaded on demand, never bundled with the product
 * ------------------------------------------------------------------ */

/**
 * Screens 2.1 / 2.3 / 2.4 and the design-system gallery, behind `React.lazy`.
 *
 * They are the parity bench: each one draws real `@partyco/ui` components against
 * `@partyco/ui/fixtures/*`, which is demo data — invented people, invented paths, invented merge
 * queues. That is exactly what it should be for a bench, and exactly what must not travel inside a
 * packaged application: a build that carries «Марина Ковалёва» in its main chunk is a build one
 * mistake away from showing her to somebody as if she were a colleague.
 *
 * Static imports made that unavoidable. Whether the bench renders at all is decided at runtime —
 * `SCAFFOLDING` reads `import.meta.env.DEV` **or** a localStorage flag — so Rollup cannot prove the
 * branch is dead and keeps every fixture module in the entry chunk. A dynamic `import()` moves the
 * decision from tree-shaking (which needs a proof) to code-splitting (which needs none): the
 * fixtures land in their own chunks and are fetched only when somebody actually opens a bench
 * screen. The localStorage escape hatch keeps working in a packaged build, because a separate chunk
 * is still a chunk that ships — it simply is not loaded until asked for.
 *
 * `ShellPage` is deliberately **not** here. It is the product, it is what a member sees a frame
 * after sign-in, and making the product wait on a second file read to save nothing is the wrong
 * trade in the only direction that matters.
 */
const WorkspacePage = lazy(() =>
  import('./pages/Workspace.tsx').then((m) => ({ default: m.WorkspacePage })),
);
const LeasesPage = lazy(() => import('./pages/Leases.tsx').then((m) => ({ default: m.LeasesPage })));
const MergeQueuePage = lazy(() =>
  import('./pages/MergeQueue.tsx').then((m) => ({ default: m.MergeQueuePage })),
);
const DesignSystemPage = lazy(() =>
  import('./pages/designsystem/index.tsx').then((m) => ({ default: m.DesignSystemPage })),
);

type View = 'shell' | 'workspace' | 'leases' | 'merge-queue' | 'design-system' | 'core';

/**
 * The design-system gallery is **not** a product surface. It is the bench where every component is
 * compared against the designer's export by eye, and that comparison is the only thing keeping the
 * code and the design from drifting — so it stays in the repo and stays buildable, but it does not
 * ship in the navigation a user sees.
 *
 * Reachable in development with `?gallery` in the URL, or by setting `partyco.gallery` to `true` in
 * localStorage. Deleting it would have been the shorter change and the wrong one.
 */
const GALLERY_ENABLED = (() => {
  try {
    if (typeof window === 'undefined') return false;
    if (window.location.search.includes('gallery')) return true;
    return window.localStorage.getItem('partyco.gallery') === 'true';
  } catch {
    return false;
  }
})();

/**
 * The development harness — the bar that says «design system · v0.1» and the switcher next to it.
 *
 * **In a packaged build the product is the shell and nothing else.** No harness bar, no list of
 * screens, no second title bar: the member opens PartyCo and is inside the app, which is the whole
 * point of a product as opposed to a preview of one. The screens the switcher reaches are still in
 * the repository and still build — they are where components are checked against their own design
 * exports — they simply are not a place a user can end up by accident.
 *
 * The gallery flag survives that on purpose. It is the documented way to open the bench (see
 * `GALLERY_ENABLED`), it cannot be set from the UI, and a packaged app loads its HTML from a `file:`
 * URL with no query string — so switching it on is a deliberate act with devtools open, which is
 * exactly who it is for.
 */
const SCAFFOLDING = import.meta.env.DEV || GALLERY_ENABLED;

/**
 * `ownChrome` — the screen draws its own `AppTitleBar` and `NavRail`, i.e. it is a real product
 * screen rather than a gallery page.
 *
 * It exists to stop this harness from doubling what the screen already has. Two title bars with two
 * theme switchers and two navigation rails side by side is not a preview of the product, it is a
 * preview of the preview — and it makes pixel comparison against the design export impossible.
 */
const VIEWS: readonly {
  id: View;
  label: string;
  icon: 'tasks' | 'folder' | 'lease' | 'merge' | 'settings' | 'local';
  ownChrome: boolean;
}[] = [
  // The product. Everything below it is the previous genre, kept reachable because those screens
  // are where the components are still checked against their own design exports — the shell
  // revision moved them, it did not delete them.
  { id: 'shell', label: 'Оболочка', icon: 'tasks', ownChrome: true },
  { id: 'workspace', label: 'Workspace', icon: 'folder', ownChrome: true },
  { id: 'leases', label: 'Leases', icon: 'lease', ownChrome: true },
  { id: 'merge-queue', label: 'Merge queue', icon: 'merge', ownChrome: true },
  ...(GALLERY_ENABLED
    ? ([{ id: 'design-system', label: 'Дизайн-система', icon: 'settings', ownChrome: false }] as const)
    : []),
  { id: 'core', label: 'Ядро', icon: 'local', ownChrome: false },
];

/** Remembered across reloads: a switcher that reopens itself every time is a switcher you fight. */
const NAV_STORAGE_KEY = 'partyco.dev-nav-open';

function readNavOpen(): boolean {
  try {
    return window.localStorage.getItem(NAV_STORAGE_KEY) !== 'false';
  } catch {
    // Private mode, a locked-down Electron partition — the harness must not fail to render over it.
    return true;
  }
}

export function App(): ReactElement | null {
  // The OS preference decides the first paint so the window does not flash the wrong theme.
  const [initialTheme, setInitialTheme] = useState<'dark' | 'light' | null>(null);

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
      <Gate workspace={workspace} />
    </ThemeProvider>
  );
}

/**
 * Sign-in gate.
 *
 * The first thing in this product that is not a fixture: the member behind the session is a real row
 * in a real database on a real server.
 *
 * A stored session is trusted for the first paint and verified against the hub straight after, so a
 * revoked or expired token drops the человек back to the panel instead of showing an app that cannot
 * do anything. If the hub is simply unreachable we keep the session: a dead server is not a logout.
 */
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

function Gate({ workspace }: { workspace: WorkspaceHandle }): ReactElement {
  const [session, setSession] = useState<HubSession | null>(readStoredSession);
  const [mode, setMode] = useState<AuthMode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        storeSession(next);
        setSession(next);
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

  if (!session) {
    // `SignInScreen` centres itself in the window and carries the mark, the sub-line and the
    // guarantee about provider keys — the gate wrapper it used to need is part of it now.
    return (
      <Door>
        <SignInScreen
          mode={mode}
          onModeChange={changeMode}
          onSubmit={submit}
          busy={busy}
          error={error}
          hubUrl={DEFAULT_HUB_URL}
        />
      </Door>
    );
  }

  return (
    <Product
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
 * «Меня позвали в проект команды» leads to the same folder picker as the primary button, because
 * joining somebody else's project needs a repository on the hub and the hub has no repositories
 * yet. That is said here, before the click, rather than discovered after it — and it is said
 * instead of drawing a join-by-code form that could not do anything: a button that lies is worse
 * than a button that is missing, and a form that lies is worse than both.
 */
const FIRST_RUN_COPY: FirstRunCopyInput = {
  folder: {
    footnote:
      'Второй шаг — ключ провайдера. Его можно пропустить: без ключа приложение работает, просто ' +
      'агент не отвечает. «Меня позвали в проект команды» пока открывает тот же выбор папки — ' +
      'присоединиться к чужому проекту получится, когда на хабе появится сам репозиторий.',
  },
};

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
}: {
  session: HubSession;
  workspace: WorkspaceHandle;
  onSignOut: () => void;
}): ReactElement {
  /**
   * Whether the key question has been dealt with in this run.
   *
   * Seeded from the folder: a member who already has one is a member who has been here before, and
   * asking them for a key on every launch would make the wizard the product. Only the walk-through
   * that just chose a folder gets step 2.
   */
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
          // Same picker, deliberately: see FIRST_RUN_COPY.
          onJoinTeam={chooseFolder}
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
          copy={FIRST_RUN_COPY}
        />
      </Door>
    );
  }

  if (!SCAFFOLDING) {
    return <ShellPage session={session} workspace={workspace} onSignOut={onSignOut} />;
  }
  return <Harness session={session} workspace={workspace} onSignOut={onSignOut} />;
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

/* ------------------------------------------------------------------ *
 * Development harness
 * ------------------------------------------------------------------ */

/**
 * The bar and the switcher. Development only — see `SCAFFOLDING`.
 *
 * Note the two title bars in dev: this one and the shell's own. That doubling is the price of a
 * bench, it is why the bench does not ship, and it is why `ownChrome` exists — the harness draws
 * theme and density controls only for the pages that have none.
 */
function Harness({
  session,
  workspace,
  onSignOut,
}: {
  session: HubSession;
  workspace: WorkspaceHandle;
  onSignOut: () => void;
}): ReactElement {
  /** What is on screen. Lags `target` by exactly as long as a lazy chunk takes to arrive. */
  const [view, setView] = useState<View>('shell');
  /** What was last clicked. Set synchronously, so the rail answers the press immediately. */
  const [target, setTarget] = useState<View>('shell');
  const [loading, startTransition] = useTransition();
  const [navOpen, setNavOpen] = useState(readNavOpen);

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_STORAGE_KEY, String(navOpen));
    } catch {
      // Not being able to remember the choice is not a reason to break the app.
    }
  }, [navOpen]);

  /**
   * Switching screens is a transition, and that is what decides what the Suspense fallback shows.
   *
   * Inside a transition React keeps the screen that is already mounted on the glass until the next
   * one is ready, instead of tearing it down to show a fallback. So the answer to "what goes in the
   * fallback" is *nothing*, and not as a shrug: on the path a person actually takes the fallback is
   * never reached at all. The old screen stays, then the new one replaces it — one paint, no gap.
   *
   * `fallback={null}` is what remains for the paths that could still reach it, and it matches the
   * choice `App` already made for its own single wait: paint nothing rather than a spinner. These
   * chunks come off local disk in a frame or two, and a spinner that appears and vanishes inside one
   * frame does not read as loading — it reads as a fault, and it invites the click that causes one.
   *
   * What is *not* silent is a wait long enough to notice: `loading` puts `aria-busy` on the main
   * region and marks the pressed rail item as current straight away, so a slow disk looks like a
   * slow disk rather than like a button that did nothing.
   */
  const go = (next: View): void => {
    setTarget(next);
    startTransition(() => setView(next));
  };

  /*
   * The chrome question follows `view`, not `target`: while a chunk is in flight the previous screen
   * is still the one being drawn, and taking its theme controls away mid-wait — or handing a second
   * pair to a screen that already has its own — would be the doubling `ownChrome` exists to prevent.
   */
  const ownChrome = VIEWS.find((v) => v.id === view)?.ownChrome ?? false;

  return (
    <div className={styles.root}>
      <TitleBar
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((open) => !open)}
        showThemeControls={!ownChrome}
        session={session}
        onSignOut={onSignOut}
      />
      <div className={styles.body}>
        {navOpen ? (
          <nav className={styles.rail} id="dev-sections" aria-label="Разделы">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={
                  v.id === target ? `${styles.railItem} ${styles.railItemActive}` : styles.railItem
                }
                onClick={() => go(v.id)}
                aria-current={v.id === target ? 'page' : undefined}
              >
                <Icon name={v.icon} />
                <span>{v.label}</span>
              </button>
            ))}
          </nav>
        ) : null}
        <main className={styles.main} aria-busy={loading}>
          {/*
            The `Suspense` sits outside the switch and is never unmounted, which is the whole reason
            the fallback stays unreached: React only keeps the current screen on the glass during a
            transition for a boundary that is *already* mounted. A boundary that appeared together
            with the screen it wraps would be suspended on its first render, and a first-render
            suspension shows its fallback — transition or not.
          */}
          <Suspense fallback={null}>
            {view === 'shell' ? (
              <ShellPage session={session} workspace={workspace} onSignOut={onSignOut} />
            ) : view === 'core' ? (
              <CoreStatusPage />
            ) : (
              /*
                Only the split screens are wrapped. `ScreenBoundary` says a specific thing — the
                screen's code never arrived — and stretching it over `ShellPage` would make it
                explain an ordinary render crash with a sentence about a file that loaded fine.
                Keyed by view so one dead chunk costs one screen: the boundary latches on failure,
                `React.lazy` caches the rejected import, and without a fresh key per screen the
                first failure would freeze the whole switcher on its apology.
              */
              <ScreenBoundary key={view}>
                {view === 'workspace' ? (
                  <WorkspacePage />
                ) : view === 'leases' ? (
                  <LeasesPage />
                ) : view === 'merge-queue' ? (
                  <MergeQueuePage />
                ) : (
                  <DesignSystemPage />
                )}
              </ScreenBoundary>
            )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/**
 * The catch under the split screens.
 *
 * A static import that cannot be resolved is a build error; a dynamic one is a runtime rejection,
 * and an uncaught rejection during render unmounts the whole tree — in a desktop app that is a white
 * window with no menu, no rail and no way back. The cost of not having this is therefore not "a
 * screen fails to open" but "the application disappears", and the cost of having it is this class.
 *
 * It says what happened and does not offer a retry, because there is nothing behind one:
 * `React.lazy` keeps the rejected promise and will hand back the same failure to every subsequent
 * render. Another screen from the rail still works — see the `key` on the usage.
 */
class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p className={styles.screenFailed}>
        Этот экран не загрузился — приложению не удалось прочитать его часть. Открой другой раздел;
        если не открывается ни один, переустанови PartyCo.
      </p>
    );
  }
}

/**
 * The harness bar. Deliberately thin on purpose: everything a real screen owns — project switcher,
 * search, theme, density — belongs to that screen's `AppTitleBar`, and duplicating it here once made
 * the preview show two of everything.
 *
 * `showThemeControls` is therefore not a preference but a fallback: the gallery and the daemon page
 * have no title bar of their own, so without it there would be no way to switch theme on them at all.
 */
function TitleBar({
  navOpen,
  onToggleNav,
  showThemeControls,
  session,
  onSignOut,
}: {
  navOpen: boolean;
  onToggleNav: () => void;
  showThemeControls: boolean;
  session: HubSession;
  onSignOut: () => void;
}): ReactElement {
  const { theme, density, toggleTheme, setDensity } = useTheme();

  return (
    <header className="pc-titlebar">
      <div data-no-drag>
        <button
          type="button"
          className={styles.navToggle}
          onClick={onToggleNav}
          aria-expanded={navOpen}
          /*
           * Only while the rail exists. It is unmounted when collapsed, not hidden, and
           * `aria-controls` pointing at an id that is not in the document is a reference a screen
           * reader offers to follow and then cannot — worse than not offering it. `aria-expanded`
           * alone still says what the button does in the state where there is nothing to point at.
           */
          {...(navOpen ? { 'aria-controls': 'dev-sections' } : {})}
          aria-label={navOpen ? 'Скрыть разделы' : 'Показать разделы'}
          title={navOpen ? 'Скрыть разделы' : 'Показать разделы'}
        >
          <Icon name="chevron-right" className={styles.navToggleIcon} />
        </button>
      </div>
      <span className={styles.brand} aria-hidden>
        <span className={styles.mark} />
        PartyCo
      </span>
      <span className={styles.stage}>design system · v0.1</span>
      <div className={styles.titleBarActions} data-no-drag>
        {showThemeControls ? (
          <>
            {/*
              Both chips print the state they are **in** and act on the press — so the accessible
              name has to carry the printed word too. It did not: the chip said «Тёмная» and
              announced «Переключить на светлую тему», which is a different control as far as
              anybody driving this by voice is concerned, and no help at all to somebody comparing
              what they hear with what a sighted colleague reads out.
            */}
            <button
              type="button"
              className={styles.chip}
              onClick={toggleTheme}
              aria-label={
                theme === 'dark'
                  ? 'Тема: тёмная. Переключить на светлую'
                  : 'Тема: светлая. Переключить на тёмную'
              }
            >
              {theme === 'dark' ? 'Тёмная' : 'Светлая'}
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
              aria-label={
                density === 'comfortable'
                  ? 'Плотность: comfortable. Переключить на compact'
                  : 'Плотность: compact. Переключить на comfortable'
              }
            >
              {density === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>
          </>
        ) : null}
        {/*
          The signed-in member. The avatar carries their colour — identity role #1 — and it is the
          same colour the hub assigned once at registration, so this square and every square on
          every screen agree by construction rather than by convention.
        */}
        <span className={styles.member} title={`${session.member.displayName} · ${session.member.email}`}>
          <span className={styles.memberAvatar} style={avatarStyle(session.member.colorSlug)}>
            {initialsOf({ name: session.member.displayName })}
          </span>
          <span className={styles.memberName}>{session.member.displayName}</span>
        </span>
        <button type="button" className={styles.chip} onClick={onSignOut}>
          Выйти
        </button>
      </div>
    </header>
  );
}
