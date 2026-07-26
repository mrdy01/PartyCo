/**
 * Generates packages/ui/src/index.ts from the per-component index.ts files, and fails loudly on a
 * duplicate exported name — two components exporting the same symbol would otherwise silently
 * shadow each other in the barrel.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UI = 'D:/code/PartyCo/packages/ui/src';
const COMPONENTS = join(UI, 'components');

const dirs = readdirSync(COMPONENTS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const owners = new Map(); // exported name -> component dir
const entries = [];

for (const dir of dirs) {
  const idx = join(COMPONENTS, dir, 'index.ts');
  let src;
  try {
    src = readFileSync(idx, 'utf8');
  } catch {
    console.warn(`!! ${dir} has no index.ts — skipped`);
    continue;
  }

  // Collect every exported identifier from `export { a, type B } from './X.tsx'` blocks.
  const names = [];
  for (const m of src.matchAll(/export\s*{([^}]*)}\s*from\s*['"][^'"]+['"]/g)) {
    for (const raw of m[1].split(',')) {
      const t = raw.trim();
      if (!t) continue;
      // strip a leading `type ` and handle `X as Y`
      const cleaned = t.replace(/^type\s+/, '');
      const alias = / as /.test(cleaned) ? cleaned.split(/ as /)[1].trim() : cleaned;
      names.push({ decl: t, name: alias });
    }
  }

  if (names.length === 0) {
    console.warn(`!! ${dir}/index.ts exported nothing recognisable — skipped`);
    continue;
  }

  const kept = [];
  for (const n of names) {
    const prior = owners.get(n.name);
    if (prior) {
      console.warn(`!! collision: "${n.name}" exported by both ${prior} and ${dir} — kept ${prior}`);
      continue;
    }
    owners.set(n.name, dir);
    kept.push(n.decl);
  }
  if (kept.length) entries.push({ dir, decls: kept });
}

const lines = [
  '/*',
  ' * GENERATED barrel — do not edit by hand.',
  ' * Rebuild with: node packages/ui/scripts/gen-barrel.mjs',
  ' */',
  '',
  "export { ThemeProvider, useTheme, type ThemeApi, type ThemeState, type ThemeProviderProps } from './theme.tsx';",
  "export * from './identity.ts';",
  '',
];

for (const e of entries) {
  if (e.decls.length === 1) {
    lines.push(`export { ${e.decls[0]} } from './components/${e.dir}/index.ts';`);
  } else {
    lines.push(`export {`);
    for (const d of e.decls) lines.push(`  ${d},`);
    lines.push(`} from './components/${e.dir}/index.ts';`);
  }
}

lines.push('');

writeFileSync(join(UI, 'index.ts'), lines.join('\n'), 'utf8');
console.log(
  `barrel: ${entries.length} components, ${owners.size} exported names -> packages/ui/src/index.ts`,
);
