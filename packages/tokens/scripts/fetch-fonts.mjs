/**
 * Fetches the two bundled webfont families into `packages/tokens/assets/fonts/`.
 *
 * Run: npm run fonts -w @partyco/tokens        (add -- --force to re-download)
 *
 * WHY THIS EXISTS
 * ---------------
 * `packages/tokens/src/fonts.css` declares @font-face against local files. Those files are
 * third-party binaries: they are not committed (see .gitignore) and they are not a dependency
 * either — adding @fontsource/* to package.json would pull ~4 MB of every weight, style and script
 * into node_modules on every install, of which this product uses twelve files per family.
 *
 * So the packages are downloaded with `npm pack` (which only touches the registry, never
 * package.json or node_modules), unpacked, and the handful of subsets the UI actually needs are
 * copied out. Both families are SIL Open Font Licence 1.1 — redistributable inside the app bundle
 * provided the licence travels with them, which is why OFL-*.txt is copied out alongside.
 *
 * WHAT IT GUARANTEES
 * ------------------
 *   1. Idempotent — with every file already in place and non-empty it does nothing (unless --force).
 *   2. Offline-honest — no network means a named failure, not a half-populated directory.
 *   3. fonts.css and the files on disk agree. Every url() in the stylesheet must resolve to a file
 *      this script placed, and every unicode-range in it must equal the range fontsource publishes
 *      for that subset. The ranges are NOT authored by hand anywhere: they come from the upstream
 *      `unicode.json`, and this check is what stops the stylesheet from drifting away from the
 *      bytes it points at. A wrong range is invisible — the glyph is simply never requested — so it
 *      has to be caught mechanically.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Read straight from the token source, the same way build-css.mjs does — Node strips the types.
// The point is to compare against the values the CSS variables are actually built from, not
// against a second copy of the family names living in this script.
import { FONT_STACKS } from '../src/palette.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, '..');
const OUT_DIR = join(TOKENS, 'assets', 'fonts');
const CSS_FILE = join(TOKENS, 'src', 'fonts.css');
/** Ranges of the last successful fetch, kept so --check works without touching the network. */
const RANGES_FILE = join(OUT_DIR, 'unicode-ranges.json');

/**
 * Pinned. An unpinned fetch would let two machines end up with different glyph coverage behind an
 * identical stylesheet, which is exactly the class of bug the range check above is meant to remove.
 */
const FAMILIES = [
  {
    pkg: '@fontsource/ibm-plex-sans',
    version: '5.3.0',
    /** fontsource's own file prefix — the placed filenames are kept verbatim so they stay traceable. */
    prefix: 'ibm-plex-sans',
    /** Must match FONT_STACKS.sans in packages/tokens/src/palette.ts, character for character. */
    family: 'IBM Plex Sans',
    licence: 'OFL-IBMPlexSans.txt',
  },
  {
    pkg: '@fontsource/jetbrains-mono',
    version: '5.3.0',
    prefix: 'jetbrains-mono',
    /** Must match FONT_STACKS.mono in packages/tokens/src/palette.ts. */
    family: 'JetBrains Mono',
    licence: 'OFL-JetBrainsMono.txt',
  },
];

/**
 * The interface is Russian and the code it shows is Latin, so both scripts are load-bearing.
 * The `-ext` halves are taken as well: they cost nothing at runtime — unicode-range means a subset
 * is only ever fetched when a codepoint inside it is actually painted — and without them a Czech
 * surname or a Ukrainian branch name drops to the fallback font mid-word, which is the single most
 * visible way a type system can break. Greek and Vietnamese are not taken: nothing in the product
 * puts them on screen, and a subset nobody needs is dead weight in the installer.
 */
const SUBSETS = ['cyrillic-ext', 'cyrillic', 'latin-ext', 'latin'];

/** The three weights the type ramp uses. See TYPE in palette.ts — nothing there asks for 700. */
const WEIGHTS = [400, 500, 600];

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log('usage: node packages/tokens/scripts/fetch-fonts.mjs [--force] [--check] [--pure]');
  console.log('  --force  re-download even when every file is already in place');
  console.log('  --check  verify what is on disk against fonts.css, download nothing');
  console.log('  --pure   ignore the system tar and use the built-in reader (for testing it)');
  process.exit(0);
}
const FORCE = args.has('--force');
const CHECK_ONLY = args.has('--check');
const PURE = args.has('--pure');

const fail = (msg) => {
  console.error(`fonts: ${msg}`);
  process.exit(1);
};

const woff2Names = (fam) =>
  SUBSETS.flatMap((s) => WEIGHTS.map((w) => `${fam.prefix}-${s}-${w}-normal.woff2`));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/* ------------------------------------------------------------------ unpacking */

/**
 * A minimal tar reader over the gunzipped stream.
 *
 * This is the fallback for machines without `tar`. Windows ships bsdtar in System32 from 10 v1803
 * on, and every Unix has one, but "almost always present" is not "present": on an older build, or
 * inside a stripped container image, the download would otherwise succeed and the unpack would die
 * with a confusing ENOENT. A tar entry is a 512-byte header followed by the body padded to 512, so
 * reading the members we want costs less than explaining the failure would.
 */
function extractPure(tgzPath, stagingDir, want) {
  const buf = gunzipSync(readFileSync(tgzPath));
  const str = (off, from, len) => {
    const slice = buf.subarray(off + from, off + from + len);
    const end = slice.indexOf(0);
    return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
  };

  let off = 0;
  /** Set by a preceding PAX header, which overrides the 100-byte name field. */
  let pendingPath = null;
  let written = 0;

  while (off + 512 <= buf.length) {
    // Two zero blocks end the archive; one is enough to know we are past the members.
    if (buf.subarray(off, off + 512).every((b) => b === 0)) break;

    const rawName = str(off, 0, 100);
    const prefix = str(off, 345, 155);
    const sizeField = str(off, 124, 12).replace(/[^0-7]/g, '');
    const size = sizeField === '' ? 0 : Number.parseInt(sizeField, 8);
    const type = String.fromCharCode(buf[off + 156]);
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x' || type === 'X') {
      // PAX extended header: "<len> path=<value>\n" records.
      const m = body.toString('utf8').match(/\d+ path=(.*)\n/);
      pendingPath = m ? m[1] : null;
      continue;
    }

    const name = pendingPath ?? (prefix ? `${prefix}/${rawName}` : rawName);
    pendingPath = null;

    // Regular files only. Directories, links and GNU extensions are not used by npm tarballs.
    if (type !== '0' && type !== '\0' && type !== '') continue;
    if (!want(name)) continue;

    const dest = join(stagingDir, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    written += 1;
  }
  return written;
}

/** True when a usable `tar` is on PATH. */
function hasTar() {
  const probe = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

/**
 * Unpacks the tarball into `stagingDir`. Prefers the system tar and falls back to the reader above.
 *
 * Two things about the invocation are deliberate:
 *   - no pattern arguments. GNU tar needs --wildcards for globs and bsdtar rejects that flag, so the
 *     portable move is to extract everything (~2 MB) and pick the files afterwards.
 *   - relative paths, run from the tarball's own directory. GNU tar reads a colon in -f as a
 *     host:path remote spec, so `-f D:/…/x.tgz` aborts trying to reach a machine called "D" —
 *     which is how this failed on the first run, on a box where Git's GNU tar shadows bsdtar.
 */
function unpack(tgzPath, stagingDir, want) {
  if (!PURE && hasTar()) {
    const res = spawnSync('tar', ['-xf', basename(tgzPath), '-C', basename(stagingDir)], {
      cwd: dirname(tgzPath),
      encoding: 'utf8',
    });
    if (!res.error && res.status === 0) return 'tar';
    const why = res.error?.message || (res.stderr ?? '').trim() || `exit ${res.status}`;
    console.warn(`fonts: system tar failed (${why}) — falling back to the built-in reader`);
  }
  const n = extractPure(tgzPath, stagingDir, want);
  if (n === 0) fail(`${basename(tgzPath)} contained none of the expected members`);
  return PURE ? 'built-in reader (--pure)' : 'built-in reader';
}

/** Downloads the tarball with `npm pack` into an empty directory and returns its path. */
function npmPack(fam, destDir) {
  // Built as one string rather than a command + argv: Windows resolves npm through npm.cmd, which
  // Node will not spawn without a shell, and passing an argv array alongside shell:true is
  // deprecated (DEP0190). Nothing here is interpolated from outside this file.
  const cmd = [
    'npm',
    'pack',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--pack-destination',
    `"${destDir}"`,
    `${fam.pkg}@${fam.version}`,
  ].join(' ');
  const res = spawnSync(cmd, {
    cwd: destDir,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
  });

  if (res.error || res.status !== 0) {
    const detail = (res.stderr ?? res.error?.message ?? '').trim();
    console.error(`fonts: could not download ${fam.pkg}@${fam.version}`);
    if (detail) console.error(detail.split('\n').slice(-6).join('\n'));
    fail(
      'the registry was unreachable. These are third-party binaries — there is no offline copy in ' +
        'the repository and nothing here can invent one. Get on a network and run this again; until ' +
        'then the app still starts, on the system fallbacks named in FONT_STACKS.',
    );
  }

  const tgz = readdirSync(destDir).filter((f) => f.endsWith('.tgz'));
  if (tgz.length !== 1) fail(`expected one .tgz from npm pack, found ${tgz.length}`);
  return join(destDir, tgz[0]);
}

/* ------------------------------------------------------------------ verification */

/**
 * The first family in each stack — the name that has to be spelled identically here and in the
 * stylesheet. Get it wrong and nothing complains anywhere: the @font-face loads, the CSS variable
 * names a family that does not exist, and the app silently renders in the fallback. That is the one
 * failure in this whole area with no visible symptom other than the wrong shapes on screen.
 */
const STACK_HEADS = new Map(
  Object.entries(FONT_STACKS).map(([key, stack]) => [
    stack.split(',')[0].trim().replace(/^['"]|['"]$/g, ''),
    key,
  ]),
);

/**
 * Checks fonts.css against what is on disk, and against palette.ts.
 *
 * `ranges` is fontsource's unicode.json (subset → range). When it is unavailable — a --check run on
 * a machine that has never fetched — the range half is skipped and said so, rather than passing
 * quietly and pretending it was verified.
 */
function verifyCss(placed, ranges) {
  if (!existsSync(CSS_FILE)) fail(`${CSS_FILE} is missing`);
  const css = readFileSync(CSS_FILE, 'utf8');
  const problems = [];

  const blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  if (blocks.length === 0) problems.push('fonts.css declares no @font-face at all');

  const referenced = new Set();
  const declaredFamilies = new Set();
  for (const block of blocks) {
    const famDecl = block.match(/font-family\s*:\s*([^;]+)/);
    const famName = famDecl ? famDecl[1].trim().replace(/^['"]|['"]$/g, '') : null;
    if (!famName) {
      problems.push('an @font-face block has no font-family');
    } else {
      declaredFamilies.add(famName);
      if (!STACK_HEADS.has(famName)) {
        problems.push(
          `font-family "${famName}" heads no FONT_STACKS entry in palette.ts — the face would load and never be applied`,
        );
      }
    }

    const url = block.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
    if (!url) {
      problems.push('an @font-face block has no url()');
      continue;
    }
    const href = url[1];
    const file = basename(href);
    referenced.add(file);

    // Resolved, not just matched by name: `../assets/font/x.woff2` names a real file and still
    // fails to build. Vite resolves the url() relative to this stylesheet, so this must too.
    if (!existsSync(resolve(dirname(CSS_FILE), href))) {
      problems.push(
        placed.has(file)
          ? `fonts.css points at ${href}, which does not resolve (the file exists, the path does not)`
          : `fonts.css points at ${href}, which is not on disk`,
      );
      continue;
    }

    const declared = block.match(/unicode-range\s*:\s*([^;]+)/);
    if (!declared) {
      problems.push(`${file}: no unicode-range — a subset without one shadows the others`);
      continue;
    }
    if (!ranges) continue;

    const subset = SUBSETS.find((s) => file.includes(`-${s}-`) && !file.includes(`-${s}-ext-`));
    if (!subset) {
      problems.push(`${file}: cannot tell which subset this is`);
      continue;
    }
    const expected = ranges[subset];
    if (!expected) {
      problems.push(`${file}: fontsource publishes no range for subset "${subset}"`);
      continue;
    }
    const norm = (s) => s.replace(/\s+/g, '').toUpperCase();
    if (norm(declared[1]) !== norm(expected)) {
      problems.push(
        `${file}: unicode-range disagrees with fontsource\n      css:      ${norm(declared[1])}\n      upstream: ${norm(expected)}`,
      );
    }
  }

  for (const file of placed) {
    if (!file.endsWith('.woff2')) continue;
    if (!referenced.has(file)) problems.push(`${file} was placed but fonts.css never references it`);
  }

  for (const [head, key] of STACK_HEADS) {
    if (!declaredFamilies.has(head)) {
      problems.push(`FONT_STACKS.${key} asks for "${head}" first, but fonts.css declares no such family`);
    }
  }

  return problems;
}

// Checked at startup rather than only against the stylesheet: if palette.ts is renamed to a family
// this script never downloads, the fetch would otherwise "succeed" and leave the app on fallbacks.
for (const fam of FAMILIES) {
  if (!STACK_HEADS.has(fam.family)) {
    fail(
      `this script fetches "${fam.family}", which heads no FONT_STACKS entry in palette.ts ` +
        `(stacks start with: ${[...STACK_HEADS.keys()].join(', ')})`,
    );
  }
}

/** Every expected filename, across both families, plus the licences. */
function expectedFiles() {
  const out = new Set();
  for (const fam of FAMILIES) {
    for (const f of woff2Names(fam)) out.add(f);
    out.add(fam.licence);
  }
  return out;
}

/** Names present in assets/fonts and non-empty, with a woff2 sanity check on the binaries. */
function onDisk() {
  if (!existsSync(OUT_DIR)) return new Set();
  const found = new Set();
  for (const entry of readdirSync(OUT_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const buf = readFileSync(join(OUT_DIR, name));
    if (buf.length === 0) continue;
    // A truncated download or an HTML error page saved as .woff2 both fail this.
    if (name.endsWith('.woff2') && buf.subarray(0, 4).toString('latin1') !== 'wOF2') continue;
    found.add(name);
  }
  return found;
}

/* ------------------------------------------------------------------ main */

const expected = expectedFiles();
let present = onDisk();
const missing = [...expected].filter((f) => !present.has(f));

if (CHECK_ONLY) {
  if (missing.length > 0) {
    console.error(`fonts: ${missing.length} of ${expected.size} file(s) missing or damaged:`);
    for (const m of missing) console.error(`  ${m}`);
    fail('run `npm run fonts -w @partyco/tokens`');
  }
  const ranges = existsSync(RANGES_FILE) ? JSON.parse(readFileSync(RANGES_FILE, 'utf8')) : null;
  if (!ranges) console.warn('fonts: no unicode-ranges.json — ranges NOT verified, re-run without --check');
  const problems = verifyCss(present, ranges);
  if (problems.length > 0) {
    console.error('fonts: fonts.css does not match what is on disk:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`fonts: OK — ${expected.size} file(s), ${ranges ? 'ranges verified' : 'ranges unchecked'}`);
  process.exit(0);
}

if (missing.length === 0 && !FORCE) {
  console.log(`fonts: up to date — ${expected.size} file(s) in packages/tokens/assets/fonts`);
  console.log('fonts: nothing to download (pass --force to fetch them again)');
  const ranges = existsSync(RANGES_FILE) ? JSON.parse(readFileSync(RANGES_FILE, 'utf8')) : null;
  if (!ranges) console.warn('fonts: no unicode-ranges.json — ranges NOT verified, run with --force');
  const problems = verifyCss(present, ranges);
  if (problems.length > 0) {
    console.error('fonts: but fonts.css does not match:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'partyco-fonts-'));
let mergedRanges = null;
try {
  for (const fam of FAMILIES) {
    const famDir = join(work, fam.prefix);
    const staging = join(famDir, 'unpacked');
    mkdirSync(staging, { recursive: true });

    const wanted = new Set(woff2Names(fam));
    const want = (name) =>
      name === 'package/LICENSE' ||
      name === 'package/unicode.json' ||
      (name.startsWith('package/files/') && wanted.has(basename(name)));

    console.log(`fonts: downloading ${fam.pkg}@${fam.version} …`);
    const tgz = npmPack(fam, famDir);
    const how = unpack(tgz, staging, want);

    const ranges = JSON.parse(readFileSync(join(staging, 'package', 'unicode.json'), 'utf8'));
    mergedRanges ??= {};
    for (const s of SUBSETS) {
      if (!ranges[s]) fail(`${fam.pkg} publishes no unicode-range for subset "${s}"`);
      // Both families are subset by the same Google pipeline, so the ranges must agree. If a future
      // version splits them differently, one stylesheet cannot describe both — say so loudly.
      if (mergedRanges[s] && mergedRanges[s] !== ranges[s]) {
        fail(`subset "${s}" has different ranges in the two families — fonts.css cannot cover both`);
      }
      mergedRanges[s] = ranges[s];
    }

    const report = [];
    for (const name of woff2Names(fam)) {
      const src = join(staging, 'package', 'files', name);
      if (!existsSync(src)) fail(`${fam.pkg}@${fam.version} does not contain files/${name}`);
      const buf = readFileSync(src);
      if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') fail(`${name} is not a woff2 file`);
      writeFileSync(join(OUT_DIR, name), buf);
      report.push([name, buf.length]);
    }

    // The OFL requires the licence to travel with the font. It is copied, not linked.
    const licence = readFileSync(join(staging, 'package', 'LICENSE'));
    writeFileSync(join(OUT_DIR, fam.licence), licence);
    report.push([fam.licence, licence.length]);

    console.log(`fonts: ${fam.pkg}@${fam.version} — unpacked with ${how}`);
    const width = Math.max(...report.map(([n]) => n.length));
    for (const [name, size] of report) console.log(`         ${name.padEnd(width)}  ${kb(size)}`);
    const total = report.reduce((a, [, s]) => a + s, 0);
    console.log(`         ${report.length} file(s), ${kb(total)}`);
  }

  writeFileSync(RANGES_FILE, `${JSON.stringify(mergedRanges, null, 2)}\n`, 'utf8');
} finally {
  rmSync(work, { recursive: true, force: true });
}

present = onDisk();
const stillMissing = [...expected].filter((f) => !present.has(f));
if (stillMissing.length > 0) fail(`still missing after the fetch: ${stillMissing.join(', ')}`);

const stray = [...present].filter((f) => f.endsWith('.woff2') && !expected.has(f));
for (const s of stray) console.warn(`fonts: ${s} is in assets/fonts but nothing asked for it`);

const problems = verifyCss(present, mergedRanges);
if (problems.length > 0) {
  console.error('fonts: the files are in place, but fonts.css does not match them:');
  for (const p of problems) console.error(`  ${p}`);
  console.error('fonts: fix packages/tokens/src/fonts.css — the ranges above come from fontsource.');
  process.exit(1);
}

console.log(`fonts: ${expected.size} file(s) in packages/tokens/assets/fonts`);
console.log('fonts: fonts.css verified — every url() resolves, every unicode-range matches upstream');
