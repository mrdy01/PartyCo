/**
 * PartyCo design tokens — raw values.
 *
 * Transcribed from `design/raw/PartyCo Design System.dc.html`, section 01–03.
 * This file is the SINGLE SOURCE OF TRUTH. `tokens.generated.css` is emitted from it
 * by `packages/tokens/scripts/build-css.mjs` — never hand-edit the CSS.
 *
 * Rule from the spec that the type system here enforces by shape:
 *   - identity colour appears in exactly THREE roles (avatar fill, 2px zone edge, diff gutter tint)
 *   - status colour appears ONLY as dot, pill or text — never a large fill, never a zone edge
 * See `IDENTITY_ROLES` / `STATUS_ROLES` below; the UI package consumes those, not raw hexes.
 */

export type ThemeName = 'dark' | 'light';

/** Neutral foundation — 12 steps, both themes complete. Spec §01. */
export interface NeutralScale {
  bgWindow: string;
  /**
   * Chrome — the title bar, the context rail, the status line, and the head of a panel that sits
   * against one of them.
   *
   * One step darker than the window in dark, one step lighter in light. It is not decoration: it is
   * what separates the frame from the work without drawing a border around everything. Before this
   * existed every chrome surface fell back to `bgWindow` and the whole shell read as one flat sheet.
   */
  bgChrome: string;
  bgPanel: string;
  bgRaised: string;
  bgInput: string;
  borderSubtle: string;
  border: string;
  borderStrong: string;
  text1: string;
  text2: string;
  text3: string;
  text4: string;
  /** Heading tint, one step brighter than text1 in dark. */
  textHeading: string;
  /**
   * Reading tone — the colour of a running paragraph in the conversation column.
   *
   * Sits deliberately BETWEEN text1 and text2. `text1` is the tone of a thing you look at (a name,
   * a value); a paragraph you read for ten seconds at that weight is loud, and at `text2` it reads
   * as secondary. The shell export uses this step for every prose line in the stream, so it is a
   * token rather than a per-component decision.
   */
  textRead: string;
}

export const NEUTRAL: Record<ThemeName, NeutralScale> = {
  dark: {
    bgWindow: '#0D0F11',
    bgChrome: '#0A0C0E',
    bgPanel: '#14171A',
    bgRaised: '#1B1F23',
    bgInput: '#22272C',
    borderSubtle: '#22262B',
    border: '#2C3237',
    borderStrong: '#3A4147',
    text1: '#E6E9EC',
    text2: '#A0A8B0',
    text3: '#6E777F',
    text4: '#4D555C',
    textHeading: '#F0F2F4',
    textRead: '#C9D0D6',
  },
  light: {
    bgWindow: '#F4F5F6',
    bgChrome: '#EFF0F2',
    bgPanel: '#FFFFFF',
    bgRaised: '#F0F1F3',
    bgInput: '#E7E9EC',
    borderSubtle: '#E6E8EA',
    border: '#D7DADD',
    borderStrong: '#C0C5CA',
    text1: '#16191C',
    text2: '#545C64',
    text3: '#7C848C',
    text4: '#A5ACB3',
    textHeading: '#0B0D0F',
    textRead: '#2E3439',
  },
};

/**
 * Link colour. Chrome, not status — a link is blue because links are blue, not because something
 * is running, so it does not come out of `STATUS.running` even though the dark values are close.
 *
 * The shell export already painted links with these hexes; this pair is what turns that into a
 * token so the two themes cannot drift apart.
 */
export interface LinkScale {
  link: string;
  linkHover: string;
}

export const LINK: Record<ThemeName, LinkScale> = {
  dark: { link: '#6FA5F8', linkHover: '#93BCFA' },
  light: { link: '#1F6FEB', linkHover: '#1A56C4' },
};

/**
 * Product accent — the brand mark and the primary-action fill.
 *
 * NOTE the trap: this is the same hex as identity slot `teal`, because the PartyCo logo is that
 * colour and the design's primary button matches it. They are nevertheless SEPARATE tokens:
 * `teal` belongs to whichever member holds that slot and may only appear in the three identity
 * roles, while the accent is chrome. Painting a primary button with `--pc-id-jewel-teal` would put
 * an identity colour outside its allowed roles and make one teammate's colour mean "primary
 * action" everywhere. If the two ever need to diverge, only this pair changes.
 */
export interface AccentScale {
  accent: string;
  accentOn: string;
  /** Neutral control surface: the secondary button / keycap fill. */
  controlBg: string;
  /** Keycap fill — differs from controlBg in light, where keycaps sit on the raised step. */
  keycapBg: string;
}

export const ACCENT: Record<ThemeName, AccentScale> = {
  dark: {
    accent: '#3FA8A0',
    accentOn: '#08110F',
    controlBg: '#22272C',
    keycapBg: '#22272C',
  },
  light: {
    accent: '#14766F',
    accentOn: '#FFFFFF',
    // In light the design draws secondary controls on white and keycaps on the raised step.
    controlBg: '#FFFFFF',
    keycapBg: '#F0F1F3',
  },
};

/** Hairline border width used throughout. Kept a token so density/HiDPI work has one lever. */
export const BORDER_WIDTH = 1;

/** Motion. Short and unobtrusive — this is a dense tool, not a landing page. */
export const MOTION = {
  durationFast: '120ms',
  durationBase: '180ms',
  ease: 'ease',
  spin: '0.7s',
} as const;

/**
 * Status semantics. Spec §01: "статусный цвет — только точка, пилюля или текст.
 * Никогда не заливка большой области, никогда не левая кромка зоны."
 */
export type StatusName = 'success' | 'warning' | 'danger' | 'running';

export interface StatusToken {
  /** Machine name used in code and in the protocol. */
  name: StatusName;
  dark: string;
  light: string;
  /** What it means — kept next to the value so nobody repurposes it. */
  meaning: string;
}

export const STATUS: readonly StatusToken[] = [
  {
    name: 'success',
    dark: '#46B96A',
    light: '#1A8A45',
    meaning: 'Merged into trunk, checks green, lease released cleanly.',
  },
  {
    name: 'warning',
    dark: '#D99A2B',
    light: '#A86B0A',
    meaning: 'Lease expiring, queue waiting, human decision needed. Also the Auto-mode accent.',
  },
  {
    name: 'danger',
    dark: '#E05252',
    light: '#C1362F',
    meaning: 'The mechanism did not hold. Always opens an incident, never raw git output.',
  },
  {
    name: 'running',
    dark: '#4D8DF6',
    light: '#1F6FEB',
    meaning: 'Work in progress: agent, tests, sync. Also the focus/selection accent.',
  },
] as const;

/**
 * The roles an identity colour may occupy — and no others.
 *
 * The first three come from spec §01. `ownershipArea` was added for the Leases screen's ownership
 * map (2.3), where a rectangle's fill IS the statement "this member owns this". The designer asked
 * whether that counted as a fourth role; it does, and naming it is better than either smuggling it
 * in as a "gutter tint" or banning it and making the map illegible. The invariant the rule actually
 * protects is unchanged: identity colour appears only where it means ownership, and never where a
 * status colour lives.
 *
 * `ownershipArea` is deliberately the LAST role. Adding a fifth should require the same argument.
 */
export const IDENTITY_ROLES = ['avatarFill', 'zoneEdge', 'diffGutter', 'ownershipArea'] as const;
export type IdentityRole = (typeof IDENTITY_ROLES)[number];

/**
 * The roles a status colour may occupy.
 *
 * `outline` joins dot/pill/text for the same screen: on the ownership map a rectangle carries its
 * owner on the 2px LEFT edge and its state on the remaining outline. That does not collide — the
 * left edge is the identity marker and stays identity's, the rest of the border is free. The
 * prohibition that matters is unchanged: status colour is never a large fill and never the
 * left-edge zone marker.
 */
export const STATUS_ROLES = ['dot', 'pill', 'text', 'outline'] as const;
export type StatusRole = (typeof STATUS_ROLES)[number];

/** Alpha for an identity colour used as an ownership-map area fill. */
export const OWNERSHIP_AREA_ALPHA: Record<ThemeName, number> = { dark: 0.13, light: 0.1 };

export interface IdentityColor {
  /** Stable slug persisted with the member; never re-derived from name or index. */
  slug: string;
  dark: string;
  light: string;
  /** Foreground for text sitting ON the avatar fill. */
  onDark: string;
  onLight: string;
}

/**
 * Identity palette "jewel" — the default. Six hues, deliberately varied in chroma so that
 * neighbouring members stay distinguishable. Spec §01.
 */
export const IDENTITY_JEWEL: readonly IdentityColor[] = [
  { slug: 'teal', dark: '#3FA8A0', light: '#14766F', onDark: '#08110F', onLight: '#FFFFFF' },
  { slug: 'rose', dark: '#D1698C', light: '#B03F63', onDark: '#1A0A10', onLight: '#FFFFFF' },
  { slug: 'violet', dark: '#9B7CD4', light: '#7350B8', onDark: '#0F0A18', onLight: '#FFFFFF' },
  { slug: 'ochre', dark: '#C8933F', light: '#94661A', onDark: '#160F04', onLight: '#FFFFFF' },
  { slug: 'indigo', dark: '#7B7FD4', light: '#5057B8', onDark: '#0A0B18', onLight: '#FFFFFF' },
  { slug: 'moss', dark: '#7D9E4F', light: '#55762B', onDark: '#0B1105', onLight: '#FFFFFF' },
] as const;

/**
 * Identity palette "narrow" — one lightness, hues around the wheel. Evener in weight but two
 * adjacent members are harder to tell apart. Spec §01: "годится для команды из 3–4 человек,
 * не из десяти." Light values are derived, not given in the spec — flagged below.
 */
export const IDENTITY_NARROW: readonly IdentityColor[] = [
  { slug: 'cyan', dark: '#3FA6C4', light: '#146E86', onDark: '#041216', onLight: '#FFFFFF' },
  { slug: 'azure', dark: '#7E9BD8', light: '#4468A8', onDark: '#070C16', onLight: '#FFFFFF' },
  { slug: 'orchid', dark: '#B389D0', light: '#7F51A0', onDark: '#120A18', onLight: '#FFFFFF' },
  { slug: 'pink', dark: '#D18AA8', light: '#A24C6E', onDark: '#180A11', onLight: '#FFFFFF' },
  { slug: 'tan', dark: '#C79A63', light: '#8C6230', onDark: '#150E05', onLight: '#FFFFFF' },
  { slug: 'olive', dark: '#8FA85F', light: '#5F7A2E', onDark: '#0C1105', onLight: '#FFFFFF' },
] as const;

export const IDENTITY_SETS = {
  jewel: IDENTITY_JEWEL,
  narrow: IDENTITY_NARROW,
} as const;

export type IdentitySetName = keyof typeof IDENTITY_SETS;

/** Alpha applied to an identity colour when used as a diff-gutter tint. Spec §01. */
export const DIFF_GUTTER_ALPHA: Record<ThemeName, number> = { dark: 0.09, light: 0.08 };

/** Alpha applied to the running/focus accent behind a selected row. Spec §03. */
export const SELECTED_ROW_ALPHA: Record<ThemeName, number> = { dark: 0.12, light: 0.09 };

/** Type ramp. Spec §02. `mono: true` means JetBrains Mono, otherwise IBM Plex Sans. */
export interface TypeStep {
  name: string;
  size: number;
  weight: number;
  lineHeight: number | 'normal';
  letterSpacing?: string;
  mono?: boolean;
  uppercase?: boolean;
}

export const TYPE: readonly TypeStep[] = [
  { name: 'display', size: 22, weight: 600, lineHeight: 1.2, letterSpacing: '-0.02em' },
  { name: 'title', size: 18, weight: 600, lineHeight: 1.25, letterSpacing: '-0.016em' },
  { name: 'head', size: 15, weight: 600, lineHeight: 1.3, letterSpacing: '-0.01em' },
  /**
   * The conversation paragraph — the main size of the product, added with the shell revision.
   * Everything a person actually reads (their own prompt, the agent's answer, an event card's
   * explanation) is set in this, and it is deliberately larger than `body`: `body` is the tone of
   * a dense list, `read` is the tone of something you read.
   */
  { name: 'read', size: 14.5, weight: 400, lineHeight: 1.68 },
  /** Heading of a card in the conversation stream. */
  { name: 'card', size: 14, weight: 600, lineHeight: 1.35 },
  { name: 'body', size: 13, weight: 400, lineHeight: 1.55 },
  /** Button, field label, tab. Half a point above `ui`, which stays the row-level UI step. */
  { name: 'label', size: 12.5, weight: 500, lineHeight: 1 },
  { name: 'ui', size: 12, weight: 500, lineHeight: 1.4 },
  /** Secondary line under a field or a card. */
  { name: 'note', size: 12, weight: 400, lineHeight: 1.55 },
  /** Counters, paths, `+19 −8`. Replaces the 9px/9.5px mono the old screens used for these. */
  { name: 'figure', size: 11.5, weight: 400, lineHeight: 1.4, mono: true },
  { name: 'meta', size: 11, weight: 400, lineHeight: 1.4 },
  /**
   * Kept, but the product no longer uses it: the shell revision replaced every eyebrow with an
   * ordinary 12.5–14px heading. It survives for the design-system gallery and the design exports
   * themselves, which are still laid out with it.
   */
  {
    name: 'eyebrow',
    size: 9.5,
    weight: 500,
    lineHeight: 1,
    letterSpacing: '0.1em',
    mono: true,
    uppercase: true,
  },
  { name: 'code', size: 12, weight: 400, lineHeight: 1.55, mono: true },
  { name: 'path', size: 11, weight: 400, lineHeight: 1.5, mono: true },
  { name: 'status', size: 10.5, weight: 400, lineHeight: 1.5, mono: true },
] as const;

export const FONT_STACKS = {
  sans: "'IBM Plex Sans', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'Cascadia Mono', 'SF Mono', Consolas, monospace",
} as const;

/** 2px-step spacing scale. Spec §03. */
export const SPACE = [2, 4, 6, 8, 12, 16, 20, 24, 32] as const;

/** Radii — low chrome, 7px is the hard maximum. Spec §03. */
export const RADIUS = {
  /** chips, dots, gutter */
  xs: 2,
  /** buttons, inputs, tabs */
  sm: 3,
  /** panels, cards, menus */
  md: 5,
  /** modals, command palette — maximum */
  lg: 7,
} as const;

/**
 * Density. Spec §02: density changes ONLY row heights, paddings and font size by 1px —
 * never hierarchy, never colour, never which fields a row contains.
 */
export interface DensityTokens {
  rowHeight: number;
  rowPaddingX: number;
  rowGap: number;
  /** Added to every type step's size. */
  fontDelta: number;
  avatarSize: number;
  avatarRadius: number;
}

export const DENSITY: Record<'comfortable' | 'compact', DensityTokens> = {
  comfortable: { rowHeight: 28, rowPaddingX: 10, rowGap: 8, fontDelta: 0, avatarSize: 15, avatarRadius: 3 },
  /**
   * `fontDelta: -1` is now load-bearing rather than arbitrary: it puts the conversation paragraph
   * (`read`, 14.5px) at exactly 13.5px, which the designer set as the floor — below it compact stops
   * being a denser application and becomes a terminal again. Making the delta more negative would
   * cross that line, so it does not move without a new `read` size to go with it.
   */
  compact: { rowHeight: 22, rowPaddingX: 8, rowGap: 7, fontDelta: -1, avatarSize: 13, avatarRadius: 2 },
};

export type DensityName = keyof typeof DENSITY;

/** Focus ring geometry. Spec §03: ring 2px + offset 1px, rendered as a двойной box-shadow. */
export const FOCUS = { ringWidth: 2, offset: 1 } as const;

/** Zone-ownership edge width. Spec §01 — identity role #2. */
export const ZONE_EDGE_WIDTH = 2;

/**
 * Width of the reading column — the conversation, and anything else that is prose rather than a
 * list. The shell revision made this the main measure of the product, so it is a token: three
 * surfaces already computed it independently, and three copies of a number are three chances to
 * disagree about what "the column" means.
 */
export const COLUMN_READ = 640;

/** Icon grid. Spec §04: 16px grid, 1.3 stroke, round caps, no fills, colour comes from the row. */
export const ICON = { size: 16, strokeWidth: 1.3 } as const;
