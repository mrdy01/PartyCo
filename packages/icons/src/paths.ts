import { ICON_PATHS as GENERATED } from './paths.generated.ts';

/**
 * The icon set — all of it extracted from the design system's §04 grid by
 * `scripts/extract.mjs`. There is no curated side-set: `paths.extra.ts` existed briefly while
 * chevrons/plus/tasks were used by the Workspace screen but missing from the catalogue, and was
 * deleted once the designer added them to the grid (their canonical geometry differs slightly from
 * the interim copies, and the grid wins).
 *
 * If a future screen needs a glyph the catalogue lacks, ask for it to be added to §04 rather than
 * reintroducing a side-set — one source keeps the design and the code from drifting.
 */
export const ICON_PATHS = GENERATED;

export type IconName = keyof typeof ICON_PATHS;

export const ICON_NAMES = Object.keys(ICON_PATHS).sort() as IconName[];

/**
 * Kept as a distinct export because the design-system page used to distinguish catalogued icons
 * from curated ones. Now identical to ICON_NAMES; retained so that page needs no change.
 */
export const ICON_NAMES_CATALOGUED = ICON_NAMES;
