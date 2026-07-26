import { useCallback, useEffect, useState } from 'react';
import {
  SignInScreen,
  ThemeProvider,
  avatarStyle,
  initialsOf,
  useTheme,
  type AuthMode,
  type AuthSubmit,
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
import { DesignSystemPage } from './pages/designsystem/index.tsx';
import { CoreStatusPage } from './pages/CoreStatus.tsx';
import { ShellPage } from './pages/Shell.tsx';
import { WorkspacePage } from './pages/Workspace.tsx';
import { LeasesPage } from './pages/Leases.tsx';
import { MergeQueuePage } from './pages/MergeQueue.tsx';
import styles from './App.module.css';

type View = 'shell' | 'workspace' | 'leases' | 'merge-queue' | 'design-system' | 'core';

/**
 * `ownChrome` — the screen draws its own `AppTitleBar` and `NavRail`, i.e. it is a real product
 * screen rather than a gallery page.
 *
 * It exists to stop this harness from doubling what the screen already has. Two title bars with two
 * theme switchers and two navigation rails side by side is not a preview of the product, it is a
 * preview of the preview — and it makes pixel comparison against the design export impossible.
 */
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

export function App() {
  // The OS preference decides the first paint so the window does not flash the wrong theme.
  const [initialTheme, setInitialTheme] = useState<'dark' | 'light' | null>(null);

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

  if (!initialTheme) return null;

  return (
    <ThemeProvider theme={initialTheme}>
      <Gate />
    </ThemeProvider>
  );
}

/**
 * Sign-in gate.
 *
 * The first thing in this product that is not a fixture: the member behind the session is a real row
 * in a real database on a real server. Everything past this gate is still demo data, and that gap is
 * the whole remaining roadmap.
 *
 * A stored session is trusted for the first paint and verified against the hub straight after, so a
 * revoked or expired token drops the человек back to the panel instead of showing an app that cannot
 * do anything. If the hub is simply unreachable we keep the session: a dead server is not a logout.
 */
function Gate() {
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

  const signOut = useCallback((current: HubSession): void => {
    storeSession(null);
    setSession(null);
    setMode('login');
    // Best effort: the local session is already gone, so a failed round-trip changes nothing here.
    void hubLogout(current.hubUrl, current.token).catch(() => undefined);
  }, []);

  if (!session) {
    // `SignInScreen` centres itself in the window and carries the mark, the sub-line and the
    // guarantee about provider keys — the gate wrapper it used to need is part of it now.
    return (
      <SignInScreen
        mode={mode}
        onModeChange={setMode}
        onSubmit={submit}
        busy={busy}
        error={error}
        hubUrl={DEFAULT_HUB_URL}
      />
    );
  }

  return <Shell session={session} onSignOut={() => signOut(session)} />;
}

function Shell({ session, onSignOut }: { session: HubSession; onSignOut: () => void }) {
  const [view, setView] = useState<View>('shell');
  const [navOpen, setNavOpen] = useState(readNavOpen);

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_STORAGE_KEY, String(navOpen));
    } catch {
      // Not being able to remember the choice is not a reason to break the app.
    }
  }, [navOpen]);

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
                className={v.id === view ? `${styles.railItem} ${styles.railItemActive}` : styles.railItem}
                onClick={() => setView(v.id)}
                aria-current={v.id === view ? 'page' : undefined}
              >
                <Icon name={v.icon} />
                <span>{v.label}</span>
              </button>
            ))}
          </nav>
        ) : null}
        <main className={styles.main}>
          {view === 'shell' ? (
            <ShellPage session={session} onSignOut={onSignOut} />
          ) : view === 'workspace' ? (
            <WorkspacePage />
          ) : view === 'leases' ? (
            <LeasesPage />
          ) : view === 'merge-queue' ? (
            <MergeQueuePage />
          ) : view === 'design-system' ? (
            <DesignSystemPage />
          ) : (
            <CoreStatusPage />
          )}
        </main>
      </div>
    </div>
  );
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
}) {
  const { theme, density, toggleTheme, setDensity } = useTheme();

  return (
    <header className="pc-titlebar">
      <div data-no-drag>
        <button
          type="button"
          className={styles.navToggle}
          onClick={onToggleNav}
          aria-expanded={navOpen}
          aria-controls="dev-sections"
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
            <button
              type="button"
              className={styles.chip}
              onClick={toggleTheme}
              aria-label={
                theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'
              }
            >
              {theme === 'dark' ? 'Тёмная' : 'Светлая'}
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
              aria-label="Переключить плотность"
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
