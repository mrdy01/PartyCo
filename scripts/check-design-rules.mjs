/**
 * Design-system lint.
 *
 * Each rule here exists because the violation actually happened while building this library and
 * was expensive to find by eye. Run with: npm run check:design
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const REPO = process.cwd();
const TOKENS_CSS = join(REPO, 'packages', 'tokens', 'src', 'tokens.generated.css');

/**
 * Both places a `.module.css` can live — and the second one was missing for a long time.
 *
 * The rules were written for the component library and only ever walked it, which left every screen
 * in the desktop app unchecked. That is the half of the codebase where a stylesheet is written under
 * time pressure next to a feature, and it is exactly where `var(--pc-line-1)` — a token that has
 * never existed — sat in a border shorthand and rendered as `currentColor` without one complaint.
 * A lint that does not look at the risky half is a lint that reassures.
 */
const SOURCE_ROOTS = [
  join(REPO, 'packages', 'ui', 'src'),
  join(REPO, 'apps', 'desktop', 'src', 'renderer', 'src'),
];

const violations = [];
const report = (file, line, rule, detail) =>
  violations.push({ file: relative(REPO, file).replaceAll('\\', '/'), line, rule, detail });

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = SOURCE_ROOTS.flatMap(walk);
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

/*
 * ── RULES 5, 6 and 7 need more than one line at a time ─────────────────────────────────────────
 *
 * Rules 1–4 are line-local: a bad token is bad wherever it appears. The three below are about
 * *promises*, and a promise is only visible when you can see the whole declaration block and the
 * markup the class lands on. So they get their own pass, with a small block parser and a small
 * JSX scanner. All three are deliberately narrow — see the notes on each.
 */

/** Selector + declarations for every rule block, at any nesting depth (`@media`, `@supports`). */
function cssBlocks(src) {
  const out = [];
  const stack = [];
  let selStart = 0;
  let line = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') line++;
    if (ch === '{') {
      stack.push({ sel: src.slice(selStart, i).trim(), bodyStart: i + 1, line });
      selStart = i + 1;
    } else if (ch === '}') {
      const b = stack.pop();
      if (b) out.push({ sel: b.sel.replace(/\s+/g, ' '), body: src.slice(b.bodyStart, i), line: b.line });
      selStart = i + 1;
    } else if (ch === ';') selStart = i + 1;
  }
  // Drop nested blocks from a wrapper's body so `@media { .x { … } }` never reads as its own decls.
  return out.map((b) => ({ ...b, decls: b.body.replace(/\{[^{}]*\}/g, '') }));
}

const declOf = (decls, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`, 'i').exec(decls);
  return m ? m[1].trim() : null;
};

/**
 * Every JSX opening tag with the attribute text that belongs to it.
 *
 * Brace-aware, because `onClick={() => close()}` contains a `>` that is not the end of the tag —
 * a naive `/<(\w+)[^>]*>/` cuts the element in half there and loses every attribute after it,
 * which is exactly the attribute (`onClick`) this rule needs to see.
 */
function openingTags(src) {
  const out = [];
  let line = 1;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') line++;
    if (src[i] !== '<') continue;
    const m = /^<([A-Za-z][\w.]*)/.exec(src.slice(i, i + 48));
    if (!m) continue;
    const openLine = line;
    let j = i + m[0].length;
    let depth = 0;
    let quote = '';
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '\n') line++;
      if (quote) {
        if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ tag: m[1], attrs: src.slice(i + m[0].length, j), line: openLine });
    i = j;
  }
  return out;
}

/** The `{…}` value of `className`, brace-matched. */
function classNameExpr(attrs) {
  const m = /className\s*=\s*\{/.exec(attrs);
  if (!m) return '';
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < attrs.length; i++) {
    if (attrs[i] === '{') depth++;
    else if (attrs[i] === '}' && --depth === 0) return attrs.slice(start + 1, i);
  }
  return attrs.slice(start + 1);
}

/**
 * class → the elements it is written on, and stylesheet → the markup that imports it.
 *
 * Only classes named *directly* in a `className={…}` are indexed. A class assembled into a local
 * (`const cls = [s.row, selected && s.selected]`) is skipped on purpose: those lists are
 * conditional, and a lint that guesses which branch was taken invents violations. Missing a case is
 * survivable; crying wolf is not — nobody re-runs a check they have learned to override.
 */
const usage = new Map();
const markup = new Map();
for (const file of tsFiles.filter((f) => f.endsWith('.tsx'))) {
  const src = readFileSync(file, 'utf8');
  const aliases = new Map();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'([^']*\.module\.css)'/g)) {
    const css = resolve(dirname(file), m[2]);
    aliases.set(m[1], css);
    if (!markup.has(css)) markup.set(css, []);
    markup.get(css).push(src);
  }
  if (aliases.size === 0) continue;
  for (const el of openingTags(src)) {
    const expr = classNameExpr(el.attrs);
    if (!expr) continue;
    for (const m of expr.matchAll(/\b(\w+)\.(\w+)\b/g)) {
      const css = aliases.get(m[1]);
      if (!css) continue;
      if (!usage.has(css)) usage.set(css, new Map());
      const byClass = usage.get(css);
      if (!byClass.has(m[2])) byClass.set(m[2], []);
      byClass.get(m[2]).push({ tag: el.tag, attrs: el.attrs, file, line: el.line });
    }
  }
}

/** Things that are a control by virtue of what they are, and attributes that make one. */
const CONTROL_TAGS = new Set([
  'button', 'a', 'label', 'summary', 'details', 'input', 'select', 'textarea', 'option',
]);
const CONTROL_ATTRS = /\b(?:role|href|tabIndex|onClick|onKeyDown|onMouseDown|onPointerDown)\s*=/;

/** `.chip` → 'chip'; `.chip:hover` → 'chip'; `button.chip`, `.chip[data-x]`, `.a .b` → null. */
const bareClass = (compound, withHover) => {
  const re = withHover ? /^\.([A-Za-z][\w-]*):hover$/ : /^\.([A-Za-z][\w-]*)$/;
  return re.exec(compound.trim())?.[1] ?? null;
};

let tracedClasses = 0;
for (const file of cssFiles) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const blocks = cssBlocks(src);
  const byClass = usage.get(resolve(file)) ?? new Map();
  const sources = markup.get(resolve(file)) ?? [];
  tracedClasses += byClass.size;

  /*
   * The sanctioned escape hatch: a qualified rule that cancels the affordance, plus the literal
   * attribute in the markup that turns it on — `.segmented[data-static='true'] .segment` next to
   * `<div … data-static="true">`. The attribute must be a literal, not an expression: a chip that
   * writes `data-free={owner ? undefined : 'true'}` has an *ownership* gate, not an interactivity
   * one, and the owned-and-inert case still lies.
   */
  const cancelled = (cls, prop, stillAffords) => {
    const mentions = new RegExp(`\\.${cls}(?![\\w-])`);
    for (const b of blocks) {
      if (!mentions.test(b.sel)) continue;
      const attrs = [...b.sel.matchAll(/\[([\w-]+)\s*=\s*['"]?([^\]'"]*)['"]?\]/g)];
      if (attrs.length === 0) continue;
      const value = declOf(b.decls, prop);
      if (value === null || stillAffords.test(value)) continue;
      if (attrs.every((a) => sources.some((s) => new RegExp(`${a[1]}\\s*=\\s*"${a[2]}"`).test(s)))) {
        return true;
      }
    }
    return false;
  };

  const accuse = (cls, prop, stillAffords, line, say) => {
    for (const u of byClass.get(cls) ?? []) {
      if (/^[A-Z]/.test(u.tag)) continue; // a React component — its own file decides the element
      if (CONTROL_TAGS.has(u.tag) || CONTROL_ATTRS.test(u.attrs)) continue;
      if (cancelled(cls, prop, stillAffords)) continue;
      report(file, line, 'affordance-on-non-control',
        `${say} — but .${cls} also lands on a bare <${u.tag}> ` +
        `(${relative(REPO, u.file).replaceAll('\\', '/')}:${u.line})`);
    }
  };

  for (const b of blocks) {
    if (b.sel.startsWith('@')) continue;

    // RULE 5 — a control affordance may not sit on something that is not a control.
    //
    // The Composer mode chip degrades to a <span> when no handler is passed, but the caret, the
    // pointer and the hover tint were written on the shared class and stayed. The result is an
    // element that looks pressable, highlights under the cursor, and does nothing — the owner read
    // it as "кнопочки не работают", and he was right: it was never a button. The same shape is
    // written the same way everywhere (`onClick ? <button …> : <span …>`), so it is worth catching
    // by machine rather than by eye.
    for (const part of b.sel.split(',')) {
      const cursorCls = bareClass(part, false);
      if (cursorCls && /cursor\s*:\s*pointer/.test(b.decls)) {
        accuse(cursorCls, 'cursor', /pointer/i, b.line, `.${cursorCls} { cursor: pointer }`);
      }
      const hoverCls = bareClass(part, true);
      if (hoverCls && /(?:^|[;{\s])(?:background|background-color|color)\s*:/.test(b.decls)) {
        accuse(hoverCls, 'background', /^$/, b.line, `.${hoverCls}:hover repaints`);
      }
    }

    // RULE 6 — focus may be moved, never deleted.
    //
    // `outline: none` with nothing put back is the worst single line in a stylesheet: the component
    // still takes a tab stop, but the person tabbing cannot see where they are. Seven components
    // legitimately write it, because they host the ring on an outer frame via
    // `:has(.control:focus-visible)` — so "a box-shadow in the same block" is too strict a test and
    // would fail all seven. The test is therefore: this block, or some other rule in this same
    // stylesheet that names the same class, must put the ring back.
    const outline = declOf(b.decls, 'outline');
    if (outline && /^(?:none|0)$/i.test(outline)) {
      const own = declOf(b.decls, 'box-shadow');
      if (own && !/^none$/i.test(own)) continue;
      const subject = b.sel.split(',')[0].trim().split(/[\s>+~]+/).pop() ?? '';
      const cls = [...subject.matchAll(/\.([A-Za-z][\w-]*)/g)].pop()?.[1];
      const mentions = cls ? new RegExp(`\\.${cls}(?![\\w-])`) : null;
      const restored =
        mentions !== null &&
        blocks.some(
          (o) => mentions.test(o.sel) && /box-shadow\s*:\s*var\(\s*--pc-focus-ring/.test(o.decls),
        );
      if (!restored) {
        report(file, b.line, 'focus-removed',
          `${b.sel} — outline: ${outline} and no --pc-focus-ring anywhere for .${cls ?? '?'}`);
      }
    }

    // RULE 7 — a ring moved outward must be silenced where it came from.
    //
    // This is the other half of RULE 6, and it is the bug the owner actually reported. `global.css`
    // rings every `:focus-visible`, which is the right default. Seven components deliberately move
    // the ring to an outer frame with `.frame:has(.control:focus-visible)` — and moving it is only
    // half the job: unless the inner control also writes `box-shadow: none`, *both* rules fire, one
    // ring hugs the control and another hugs the frame, and 3px of saturated blue drawn twice reads
    // as a broken border rather than as focus. It cost a bug report worded «выделение какое-то
    // ужасное синее» to find, and nothing but eyes would have found it — the ring is present, the
    // token is right, every declaration in isolation is correct.
    //
    // So: whoever writes the outer ring must also silence the inner one, in this same stylesheet.
    for (const part of b.sel.split(',')) {
      const has = /:has\(\s*([^)]*?):focus-visible\s*\)/.exec(part);
      if (!has) continue;
      if (!/box-shadow\s*:\s*var\(\s*--pc-focus-ring/.test(b.decls)) continue;
      const inner = [...(has[1] ?? '').matchAll(/\.([A-Za-z][\w-]*)/g)].pop()?.[1];
      if (!inner) continue;
      const silenced = blocks.some(
        (o) =>
          new RegExp(`\\.${inner}(?![\\w-])[^,{]*:focus-visible`).test(o.sel) &&
          /^none$/i.test(declOf(o.decls, 'box-shadow') ?? ''),
      );
      if (!silenced) {
        report(file, b.line, 'focus-ring-doubled',
          `${part.trim()} moves the ring outward — .${inner}:focus-visible must set ` +
            'box-shadow: none, or the global ring draws a second one inside it');
      }
    }
  }
}

if (violations.length === 0) {
  console.log(
    `design rules: OK — ${cssFiles.length} stylesheets, ${tsFiles.length} modules, ` +
      `${definedTokens.size} tokens, ${tracedClasses} classes traced to markup`,
  );
  process.exit(0);
}

const byRule = new Map();
for (const v of violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);

console.error(`design rules: ${violations.length} violation(s)\n`);
for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.detail}`);
console.error('\nsummary:');
for (const [rule, count] of byRule) console.error(`  ${rule}: ${count}`);
process.exit(1);
