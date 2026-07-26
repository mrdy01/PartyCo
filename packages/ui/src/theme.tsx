import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { DensityName, IdentitySetName, ThemeName } from '@partyco/tokens';

export interface ThemeState {
  theme: ThemeName;
  density: DensityName;
  /** Which identity palette the project uses. Persisted per project, not per client. */
  identitySet: IdentitySetName;
}

export interface ThemeApi extends ThemeState {
  setTheme: (t: ThemeName) => void;
  setDensity: (d: DensityName) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export interface ThemeProviderProps extends Partial<ThemeState> {
  children: ReactNode;
  /**
   * When true (the default) the provider stamps `data-theme` / `data-density` on
   * `document.documentElement` so the generated token CSS applies globally. Set false when
   * rendering an isolated preview that must not disturb the host document — the attributes are
   * then written on a wrapper element instead.
   */
  global?: boolean;
}

/**
 * Owns the two attributes the token CSS keys off: `data-theme` and `data-density`.
 * Dark is the primary theme per spec, but light is a full equivalent — never a degraded copy.
 */
export function ThemeProvider({
  children,
  theme: themeProp,
  density: densityProp,
  identitySet = 'jewel',
  global = true,
}: ThemeProviderProps): React.ReactElement {
  const [theme, setTheme] = useState<ThemeName>(themeProp ?? 'dark');
  const [density, setDensity] = useState<DensityName>(densityProp ?? 'comfortable');

  // Controlled when the prop is supplied, uncontrolled otherwise.
  useEffect(() => {
    if (themeProp) setTheme(themeProp);
  }, [themeProp]);
  useEffect(() => {
    if (densityProp) setDensity(densityProp);
  }, [densityProp]);

  useEffect(() => {
    if (!global) return;
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-density', density);
  }, [global, theme, density]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const api = useMemo<ThemeApi>(
    () => ({ theme, density, identitySet, setTheme, setDensity, toggleTheme }),
    [theme, density, identitySet, toggleTheme],
  );

  if (global) {
    return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
  }
  return (
    <ThemeContext.Provider value={api}>
      <div data-theme={theme} data-density={density}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
