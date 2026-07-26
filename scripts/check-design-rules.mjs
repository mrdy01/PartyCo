/**
 * Design-system lint.
 *
 * Each rule here exists because the violation actually happened while building this library and
 * was expensive to find by eye. Run with: npm run check:design
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = process.cwd();
const UI_SRC = join(REPO, 'packages', 'ui', 'src');
const TOKENS_CSS = join(REPO, 'packages', 'tokens', 'src', 'tokens.generated.css');

const violations = [];
const report = (file, line, rule, detail) =>
  violations.push({ file: relative(REPO, file).replaceAll('\\', '/'), line, rule, detail });

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk(UI_SRC);
const cssFiles = files.filter((f) => f.endsWith('.module.css'));
const tsFiles = files.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));

/** Every `--pc-*` the token layer actually defines. */
const definedTokens = new Set(
  [...readFileSync(TOKENS_CSS, 'utf8').matchAll(/^\s*(--pc-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
);

/**
 * Blanks out /* … *\/ comments across the whole file, preserving line numbering, so prose that
 * quotes a hex value (e.g. "the accent is #3FA8A0") is not reported as a raw colour.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

for (const file of cssFiles) {
  const raw = readFileSync(file, 'utf8');
  const lines = stripComments(raw).split(/\r?\n/);
  lines.forEach((code, i) => {
    const n = i + 1;

    // RULE 1 — global keyframes referenced from a CSS module must be wrapped in global().
    // Vite localises animation names, so a bare `pc-pulse` compiles to a name that does not exist
    // and the animation silently never runs.
    // Anchored on the property, not the line start, so a one-line rule block is still checked.
    for (const decl of code.matchAll(/animation(?:-name)?\s*:([^;}]*)/g)) {
      const value = decl[1] ?? '';
      const bare = value.match(/(?<!global\()\b(pc-(?:shimmer|pulse|spin|march|caret))\b/);
      if (bare && !value.includes(`global(${bare[1]})`)) {
        report(file, n, 'animation-not-global', `use global(${bare[1]}) — bare name is localised`);
      }
    }

    // RULE 2 — no raw colours. Everything must come from a token.
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/);
    if (hex) report(file, n, 'raw-colour', `${hex[0]} — use a --pc-* token`);
    const fn = code.match(/\b(rgba?|hsla?)\s*\(\s*\d/);
    if (fn) report(file, n, 'raw-colour', `${fn[1]}() literal — use a --pc-* token`);

    // RULE 3 — identity tokens may not be referenced directly from component CSS. Their three
    // allowed roles all go through the helpers in src/identity.ts, which take the member's slug.
    const id = code.match(/var\(\s*(--pc-id-(?:jewel|narrow)-[a-z]+[a-z-]*)\s*\)/);
    if (id) {
      report(file, n, 'identity-token-in-css', `${id[1]} — identity colour comes from identity.ts helpers`);
    }

    // RULE 4 — no reference to a token that does not exist.
    for (const m of code.matchAll(/var\(\s*(--pc-[a-z0-9-]+)/g)) {
      const t = m[1];
      // Component-local custom properties are allowed if they are declared in the same file.
      if (definedTokens.has(t)) continue;
      const declaredLocally = new RegExp(`^\\s*${t}\\s*:`, 'm').test(raw);
      if (!declaredLocally) report(file, n, 'unknown-token', `${t} is not defined by the token layer`);
    }
  });
}

for (const file of tsFiles) {
  if (file.endsWith('identity.ts')) continue; // the helpers are the sanctioned place
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    const id = code.match(/--pc-id-(?:jewel|narrow)-[a-z]+/);
    if (id) {
      report(file, i + 1, 'identity-token-in-tsx', `${id[0]} — use avatarStyle/zoneEdgeStyle/diffGutterStyle`);
    }
  });
}

if (violations.length === 0) {
  console.log(`design rules: OK — ${cssFiles.length} stylesheets, ${tsFiles.length} modules, ${definedTokens.size} tokens`);
  process.exit(0);
}

const byRule = new Map();
for (const v of violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);

console.error(`design rules: ${violations.length} violation(s)\n`);
for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.detail}`);
console.error('\nsummary:');
for (const [rule, count] of byRule) console.error(`  ${rule}: ${count}`);
process.exit(1);
