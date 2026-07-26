export * from './palette.ts';

import {
  DENSITY,
  DIFF_GUTTER_ALPHA,
  IDENTITY_SETS,
  NEUTRAL,
  SELECTED_ROW_ALPHA,
  STATUS,
  type DensityName,
  type DensityTokens,
  type IdentityColor,
  type IdentitySetName,
  type StatusName,
  type ThemeName,
} from './palette.ts';

/** `#RRGGBB` → `rgba(r, g, b, a)`. Used for the two tint roles that need alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) {
    throw new Error(`withAlpha: not a 6-digit hex colour: ${hex}`);
  }
  // eslint-disable-next-line no-bitwise
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function neutral(theme: ThemeName) {
  return NEUTRAL[theme];
}

export function status(name: StatusName, theme: ThemeName): string {
  const found = STATUS.find((s) => s.name === name);
  if (!found) throw new Error(`unknown status token: ${name}`);
  return theme === 'dark' ? found.dark : found.light;
}

export function density(name: DensityName): DensityTokens {
  return DENSITY[name];
}

export function identitySet(name: IdentitySetName): readonly IdentityColor[] {
  return IDENTITY_SETS[name];
}

export function identityBySlug(slug: string, set: IdentitySetName = 'jewel'): IdentityColor {
  const found = IDENTITY_SETS[set].find((c) => c.slug === slug);
  if (!found) throw new Error(`unknown identity slug "${slug}" in set "${set}"`);
  return found;
}

/**
 * Assign an identity colour to a member. Deterministic and STABLE: the slug is persisted with
 * the member on first join and never recomputed — spec §01 says the colour "закрепляется навсегда
 * при входе в проект". This helper only picks the next free slug at join time.
 *
 * Beyond six members the palette repeats; the caller must surface that rather than silently
 * colliding — two members sharing a colour breaks the product's core "who owns what" read.
 */
export function nextIdentitySlug(
  taken: readonly string[],
  set: IdentitySetName = 'jewel',
): { slug: string; exhausted: boolean } {
  const palette = IDENTITY_SETS[set];
  const free = palette.find((c) => !taken.includes(c.slug));
  if (free) return { slug: free.slug, exhausted: false };
  const fallback = palette[taken.length % palette.length];
  if (!fallback) throw new Error('identity palette is empty');
  return { slug: fallback.slug, exhausted: true };
}

/** Identity role #3 — diff gutter tint. */
export function diffGutterTint(slug: string, theme: ThemeName, set: IdentitySetName = 'jewel'): string {
  const c = identityBySlug(slug, set);
  return withAlpha(theme === 'dark' ? c.dark : c.light, DIFF_GUTTER_ALPHA[theme]);
}

/** Selected-row background — the running/focus accent at low alpha. Spec §03. */
export function selectedRowTint(theme: ThemeName): string {
  return withAlpha(status('running', theme), SELECTED_ROW_ALPHA[theme]);
}

/**
 * Focus ring as a single box-shadow. Spec §03: ring 2px + offset 1px, so the inner shadow is the
 * surface colour (the "offset") and the outer is the accent.
 */
export function focusRing(theme: ThemeName, surface: string = NEUTRAL[theme].bgPanel): string {
  return `0 0 0 1px ${surface}, 0 0 0 3px ${status('running', theme)}`;
}
