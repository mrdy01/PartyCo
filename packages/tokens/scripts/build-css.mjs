/**
 * Emits `packages/tokens/src/tokens.generated.css` from `packages/tokens/src/palette.ts`.
 *
 * Relies on Node's native TypeScript type-stripping (Node >= 22.18 / 24). palette.ts is written
 * with erasable syntax only, so no build step is needed to read it.
 *
 * Run: npm run build:tokens
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACCENT,
  BORDER_WIDTH,
  MOTION,
  DENSITY,
  DIFF_GUTTER_ALPHA,
  OWNERSHIP_AREA_ALPHA,
  FONT_STACKS,
  IDENTITY_SETS,
  LINK,
  NEUTRAL,
  RADIUS,
  SELECTED_ROW_ALPHA,
  SPACE,
  STATUS,
  TYPE,
  ZONE_EDGE_WIDTH,
  COLUMN_READ,
  ICON,
  FOCUS,
} from '../src/palette.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'src', 'tokens.generated.css');

/** camelCase / trailing-digit → kebab: `bgWindow` → `bg-window`, `text1` → `text-1`. */
const kebab = (s) =>
  s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/([a-z])(\d)/g, '$1-$2');

function rgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Emit the neutral + status + identity vars for one theme. */
function themeVars(theme, indent = '  ') {
  const L = [];
  L.push(`${indent}/* neutral foundation */`);
  for (const [k, v] of Object.entries(NEUTRAL[theme])) {
    L.push(`${indent}--pc-${kebab(k)}: ${v};`);
  }
  L.push('');
  L.push(`${indent}/* accent + control surfaces — chrome, NOT identity */`);
  for (const [k, v] of Object.entries(ACCENT[theme])) {
    L.push(`${indent}--pc-${kebab(k)}: ${v};`);
  }
  L.push('');
  L.push(`${indent}/* link — chrome, not status */`);
  for (const [k, v] of Object.entries(LINK[theme])) {
    L.push(`${indent}--pc-${kebab(k)}: ${v};`);
  }
  L.push('');
  L.push(`${indent}/* status — dot / pill / text only */`);
  for (const s of STATUS) {
    L.push(`${indent}--pc-status-${s.name}: ${theme === 'dark' ? s.dark : s.light};`);
  }
  L.push('');
  L.push(`${indent}/* identity — avatar fill / zone edge / diff gutter only */`);
  for (const [setName, colors] of Object.entries(IDENTITY_SETS)) {
    for (const c of colors) {
      const base = theme === 'dark' ? c.dark : c.light;
      const on = theme === 'dark' ? c.onDark : c.onLight;
      L.push(`${indent}--pc-id-${setName}-${c.slug}: ${base};`);
      L.push(`${indent}--pc-id-${setName}-${c.slug}-on: ${on};`);
      L.push(
        `${indent}--pc-id-${setName}-${c.slug}-gutter: ${rgba(base, DIFF_GUTTER_ALPHA[theme])};`,
      );
      L.push(
        `${indent}--pc-id-${setName}-${c.slug}-area: ${rgba(base, OWNERSHIP_AREA_ALPHA[theme])};`,
      );
    }
  }
  L.push('');
  L.push(`${indent}/* derived */`);
  const running = STATUS.find((s) => s.name === 'running');
  L.push(
    `${indent}--pc-selected-row-bg: ${rgba(theme === 'dark' ? running.dark : running.light, SELECTED_ROW_ALPHA[theme])};`,
  );
  L.push(
    `${indent}--pc-focus-ring: 0 0 0 ${FOCUS.offset}px var(--pc-bg-panel), 0 0 0 ${FOCUS.offset + FOCUS.ringWidth}px var(--pc-status-running);`,
  );
  L.push(`${indent}color-scheme: ${theme};`);
  return L.join('\n');
}

const lines = [];
lines.push('/*');
lines.push(' * GENERATED from packages/tokens/src/palette.ts — do not edit.');
lines.push(' * Rebuild with: npm run build:tokens');
lines.push(' */');
lines.push('');

// Fonts are bundled locally, never fetched from a CDN: the Electron renderer runs under a strict
// CSP with no external hosts, and the app must work fully offline.
lines.push('/* Fonts: see packages/tokens/src/fonts.css for the @font-face declarations. */');
lines.push('');

lines.push(':root {');
lines.push(themeVars('dark'));
/**
 * The type ramp.
 *
 * IMPORTANT: this block must be re-emitted inside every density rule, not declared once on :root.
 * A `var()` nested inside a custom property's value is substituted when THAT property is computed,
 * i.e. on the element carrying the declaration — not where the property is finally used. Declared
 * only on :root, `calc(11px + var(--pc-font-delta, 0px))` freezes with the :root delta (0px), and
 * `<div data-density="compact">` then gets the smaller row height but the unchanged font size —
 * silently losing half of the density spec. Re-emitting the ramp inside `[data-density="compact"]`
 * lets it resolve against the -1px delta declared in the same rule.
 */
function typeRamp(indent = '  ') {
  const L = [];
  for (const t of TYPE) {
    const family = t.mono ? 'var(--pc-font-mono)' : 'var(--pc-font-sans)';
    L.push(
      `${indent}--pc-type-${t.name}: ${t.weight} calc(${t.size}px + var(--pc-font-delta, 0px)) / ${t.lineHeight} ${family};`,
    );
    if (t.letterSpacing) L.push(`${indent}--pc-tracking-${t.name}: ${t.letterSpacing};`);
  }
  return L.join('\n');
}

lines.push('');
lines.push('  /* typography */');
lines.push(`  --pc-font-sans: ${FONT_STACKS.sans};`);
lines.push(`  --pc-font-mono: ${FONT_STACKS.mono};`);
lines.push(typeRamp());
lines.push('');
lines.push('  /* spacing — 2px step */');
for (const s of SPACE) lines.push(`  --pc-space-${s}: ${s}px;`);
lines.push('');
lines.push('  /* radii — 7px is the hard maximum */');
for (const [k, v] of Object.entries(RADIUS)) lines.push(`  --pc-radius-${k}: ${v}px;`);
lines.push('');
lines.push('  /* structural */');
lines.push(`  --pc-zone-edge-width: ${ZONE_EDGE_WIDTH}px;`);
lines.push(`  --pc-column-read: ${COLUMN_READ}px;`);
lines.push(`  --pc-border-width: ${BORDER_WIDTH}px;`);
lines.push(`  --pc-icon-size: ${ICON.size}px;`);
lines.push(`  --pc-icon-stroke: ${ICON.strokeWidth};`);
lines.push('');
lines.push('  /* motion */');
lines.push(`  --pc-duration-fast: ${MOTION.durationFast};`);
lines.push(`  --pc-duration-base: ${MOTION.durationBase};`);
lines.push(`  --pc-ease: ${MOTION.ease};`);
lines.push(`  --pc-duration-spin: ${MOTION.spin};`);
lines.push('');
lines.push('  /* density — comfortable is the default */');
for (const [k, v] of Object.entries(DENSITY.comfortable)) {
  lines.push(`  --pc-${kebab(k)}: ${k === 'fontDelta' ? `${v}px` : `${v}px`};`);
}
lines.push('}');
lines.push('');

lines.push('[data-theme="light"] {');
lines.push(themeVars('light'));
lines.push('}');
lines.push('');

lines.push('[data-density="compact"] {');
for (const [k, v] of Object.entries(DENSITY.compact)) {
  lines.push(`  --pc-${kebab(k)}: ${v}px;`);
}
lines.push('');
lines.push('  /* Ramp re-emitted so it resolves against the -1px delta above — see typeRamp(). */');
lines.push(typeRamp());
lines.push('}');
lines.push('');

lines.push('/* Motion. Respects reduced-motion: the app must stay legible without animation. */');
lines.push('@keyframes pc-shimmer { 0% { background-position: -180% 0 } 100% { background-position: 180% 0 } }');
lines.push('@keyframes pc-pulse { 0%, 100% { opacity: .35 } 50% { opacity: 1 } }');
lines.push('@keyframes pc-spin { to { transform: rotate(360deg) } }');
lines.push('@keyframes pc-march { to { background-position: 14px 0 } }');
lines.push('@keyframes pc-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }');
lines.push('');
lines.push('@media (prefers-reduced-motion: reduce) {');
lines.push('  *, *::before, *::after {');
lines.push('    animation-duration: 0.01ms !important;');
lines.push('    animation-iteration-count: 1 !important;');
lines.push('    transition-duration: 0.01ms !important;');
lines.push('  }');
lines.push('}');
lines.push('');

const out = lines.join('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out, 'utf8');

const emitted = out.split('\n');
const varCount = emitted.filter((l) => l.trimStart().startsWith('--pc-')).length;
console.log(`tokens: wrote ${outFile}`);
console.log(`tokens: ${varCount} custom properties, ${emitted.length} lines`);
