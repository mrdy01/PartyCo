import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { RU } from './ru.ts';
import { EN } from './en.ts';

/**
 * Two languages, and a shape that cannot drift between them.
 *
 * PartyCo was written in Russian throughout — not labels, but prose: the sentence a person reads
 * when their folder could not be opened is an argument, not a caption. Going open-source made that
 * a wall rather than a style: a stranger who cannot read it cannot evaluate the product at all.
 *
 * **The mechanism that matters here is the type, not the hook.** `ru.ts` is the source of truth for
 * the *shape* of the dictionary, `Dictionary` widens its literals to `string`, and `en.ts` is
 * annotated with it — so an English entry that is missing, misspelled or left behind after a Russian
 * one is renamed is a type error at `npm run check`, not a Russian sentence appearing in an English
 * window. Nothing here has to be remembered by anybody.
 *
 * **Scope, stated plainly, because a half-translated product is worse than an honest boundary:**
 * this covers the surfaces a person actually meets — the first run, the sign-in, the shell's own
 * chrome, the composer, the settings. The development bench (Workspace / Leases / Merge queue and
 * the design-system gallery) is not translated and is not meant to be: it does not ship in a
 * packaged build, `SCAFFOLDING` keeps it out, and translating a bench would be work whose only
 * reader already speaks Russian. Where a product surface is still missing an entry, adding it is
 * mechanical: put the Russian in `ru.ts`, and the compiler will then demand the English.
 */

/** The languages the product speaks. */
export type Lang = 'ru' | 'en';

export const LANGS: readonly Lang[] = ['ru', 'en'];

/** What the switch says, each in its own language — never «Russian» to somebody reading Russian. */
export const LANG_LABEL: Record<Lang, string> = {
  ru: 'Русский',
  en: 'English',
};

/**
 * Widen the literal types of the Russian dictionary into the contract English must satisfy.
 *
 * Without this, `typeof RU` would type a leaf as its own literal (`'Отправить'`) and no English
 * string could ever satisfy it. Functions are carried through unchanged so that an entry needing a
 * number or a name can be a function of it — which is also why interpolation lives in the
 * dictionary rather than in a format string: a language whose plural or word order differs gets to
 * write its own function instead of being bent around Russian's.
 */
type Widen<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R
    : T[K] extends string
      ? string
      : Widen<T[K]>;
};

export type Dictionary = Widen<typeof RU>;

const DICTIONARIES: Record<Lang, Dictionary> = { ru: RU, en: EN };

export interface LocaleApi {
  lang: Lang;
  t: Dictionary;
  setLang: (lang: Lang) => void;
}

/**
 * Russian without a provider, deliberately.
 *
 * Every bench screen and every gallery card renders outside `LocaleProvider`, and they are Russian
 * by nature. Throwing here — the way `useTheme` does — would turn "somebody opened the design-system
 * page" into a crash, and defaulting to English would silently retranslate surfaces nobody asked to
 * translate.
 */
const LocaleContext = createContext<LocaleApi>({
  lang: 'ru',
  t: RU,
  setLang: () => {},
});

export interface LocaleProviderProps {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  children: ReactNode;
}

export function LocaleProvider({
  lang,
  onLangChange,
  children,
}: LocaleProviderProps): React.ReactElement {
  const api = useMemo<LocaleApi>(
    () => ({ lang, t: DICTIONARIES[lang], setLang: onLangChange }),
    [lang, onLangChange],
  );
  return <LocaleContext.Provider value={api}>{children}</LocaleContext.Provider>;
}

/** The active language and the means to change it. */
export function useLocale(): LocaleApi {
  return useContext(LocaleContext);
}

/** The dictionary alone — what a component almost always wants. */
export function useT(): Dictionary {
  return useContext(LocaleContext).t;
}

export { RU, EN };
