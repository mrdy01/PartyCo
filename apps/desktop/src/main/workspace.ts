import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import {
  mkdir,
  open,
  opendir,
  readFile as readFileRaw,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { platformPaths } from './platform.ts';
import type {
  IpcResult,
  Page,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceInfo,
} from '../preload/contracts.ts';

/**
 * The real working folder: choosing it, remembering it, listing it, reading one file out of it.
 *
 * Everything here answers about a folder that actually exists on this machine. There is no seeded
 * project, no example tree and no placeholder file — when nothing has been chosen the honest answer
 * is `null`, and the renderer draws an empty state that says why.
 *
 * Two things dominate the design.
 *
 * **The renderer is untrusted, and it hands us paths.** It draws repository text and model output,
 * both attacker-influenceable, so «src/main/index.ts» arriving over IPC is a *claim*, not a path.
 * Every claim goes through {@link resolveInside} and nothing else in this file touches the
 * filesystem with a renderer-supplied string that did not come back out of it. That function is
 * deliberately written to be read start to finish: a containment check nobody can follow is a
 * containment check nobody can trust.
 *
 * **Refuse rather than distort.** A binary file is not decoded as if it were text, a 40 MB file is
 * not streamed into a web page, and a directory too large to list whole comes back as a page that
 * states how many entries it does not contain — never as a truncated list that looks complete. Each
 * of those answers says what happened. The same reasoning as `agents.ts`: a sentence a person can
 * read beats a plausible result.
 *
 * What is NOT here: git *operations*. `branch` is read out of `.git/HEAD` as a string, because a
 * spawned `git` is a dependency on a binary that may not exist and a process on the UI's critical
 * path for the sake of one line of text. Worktrees, merge gates and everything else in
 * docs/architecture.md belong to the core daemon, which does not exist yet — and until it does this
 * file says «not a git repository» or nothing at all rather than inventing a branch.
 */

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

/** Name of the state file inside `platformPaths().config`. */
const STATE_FILE = 'workspace.json';

/** Bumped when the shape below changes; an older or newer file reads as «nothing remembered». */
const STATE_VERSION = 1;

/**
 * Entries returned for one directory.
 *
 * A generated folder we failed to filter (a `venv`, a build cache, a downloads dump) can hold tens
 * of thousands of files. Serialising that across the bridge and turning it into DOM nodes is a
 * frozen window, so past this point the rest is left out of the answer — and counted. The page
 * carries how many entries are missing and the panel says the number in words; see
 * {@link listDirectory}.
 */
const MAX_ENTRIES = 2000;

/**
 * How large the working buffer is allowed to grow while a big directory is being read.
 *
 * The first {@link MAX_ENTRIES} entries *in display order* are not the first ones the filesystem
 * hands over: NTFS returns names already sorted, ext4 returns them in hash order, and either way
 * «directories first» cuts across whatever order arrives. So the page cannot be decided until every
 * entry has been seen — but holding every entry is exactly what a hundred-thousand-file folder must
 * not be able to make us do. The buffer is therefore sorted and cut back to `MAX_ENTRIES` whenever
 * it reaches this size: memory stays at twice a page, and what survives each cut is still precisely
 * the entries that come first in display order.
 */
const PRUNE_AT = MAX_ENTRIES * 2;

/** 2 MB. Past this a file is a data file, not something a person reads in a panel. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** A NUL in the first 8 KB means «not text». Real source files never contain one. */
const BINARY_SNIFF_BYTES = 8192;

/** `.git/HEAD` is one short line; anything larger is not a HEAD we should be parsing. */
const MAX_GIT_BYTES = 4096;

/** A branch name goes on screen. A repository is allowed to be hostile; the UI is not. */
const MAX_BRANCH_CHARS = 255;

/** Longer than any real path, short enough that a megabyte of «../» is rejected before `resolve`. */
const MAX_REL_CHARS = 4096;

/**
 * Directories never listed.
 *
 * `.git` because its contents are plumbing, not the member's project; the rest because they are
 * generated output that is large, uninteresting, and the main reason a file tree feels slow.
 * Hidden files *are* shown — dotfiles are frequently the thing you actually came to look at.
 *
 * Matched by name against directories only. `build`, `out` and `target` are also perfectly ordinary
 * names for a script or a source file, and hiding a file the member wrote would be the same class of
 * lie as inventing one.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  'target',
  '__pycache__',
  '.venv',
]);

/**
 * Control characters in a path claim.
 *
 * NUL is the one that matters: many OS APIs are C strings underneath, so `«ok.txt\0../../etc»`
 * historically passed a JavaScript check and then addressed a different file. The rest are refused
 * with it because no legitimate path from our own tree contains them.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/* ------------------------------------------------------------------ *
 * Result helpers — same shape as agents.ts, on purpose
 * ------------------------------------------------------------------ */

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function succeed<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Native separators to the `/` the contract promises. Display order is the renderer's only job. */
function toPosix(value: string): string {
  return sep === '/' ? value : value.split(sep).join('/');
}

/* ------------------------------------------------------------------ *
 * Path containment — the load-bearing part of this file
 * ------------------------------------------------------------------ */

export interface ResolvedPath {
  /** Absolute, fully symlink-resolved location on this machine. */
  absolute: string;
  /** Canonical workspace-relative path with `/` separators. Empty string for the root itself. */
  relative: string;
  /** The workspace root, symlink-resolved. Every check above was made against this string. */
  root: string;
}

/**
 * Windows and macOS compare paths case-insensitively; Linux does not.
 *
 * The comparison has to match the filesystem's own, and it has to err towards *refusing*. Folding
 * case where the OS folds case is the strict choice: `C:\Proj\..\PROJ-EVIL` and `C:\proj-evil` are
 * the same file to Windows, so treating them as different strings would be the lenient mistake.
 */
function foldCase(value: string): string {
  return process.platform === 'linux' ? value : value.toLowerCase();
}

/**
 * True when `target` is `root` itself or something beneath it.
 *
 * The separator is not decoration. `startsWith` on the raw strings accepts `C:\proj-evil` for the
 * root `C:\proj`, which is a neighbouring folder the member never opened — a whole repository
 * readable through one missing character. Comparing `C:\proj-evil` against the prefix `C:\proj\`
 * fails, which is the entire point.
 */
function isInside(root: string, target: string): boolean {
  const r = foldCase(root);
  const t = foldCase(target);
  if (t === r) return true;
  return t.startsWith(r.endsWith(sep) ? r : r + sep);
}

/**
 * Turn a workspace-relative claim from the renderer into a real path, or into the reason it is not
 * one. **Every filesystem access in this file starts here.**
 *
 * The order is deliberate:
 *
 * 1. Cheap textual refusals first — no syscall for input that cannot possibly be valid.
 * 2. `realpath(root)`, so the comparison base is the real folder and not a symlink to it.
 * 3. `resolve`, which collapses `..` — the lexical check right after it rejects a claim that climbs
 *    out even if the path does not exist yet.
 * 4. `realpath(target)`, then the same check again. This is the one that matters: step 3 sees the
 *    text, step 4 sees where the filesystem actually goes. A symlink named `docs` pointing at
 *    `C:\Users\me\.ssh` is textually impeccable and is refused here.
 *
 * Two Windows specifics are handled by refusing the input outright rather than by trying to be
 * clever: `C:foo` is *drive-relative* (it resolves against the current directory of drive C, not
 * against our root), and `file.txt:stream` addresses an alternate data stream. Both contain a colon,
 * and a legitimate relative path inside a repository never does. Device names — `NUL`, `CON`,
 * `\\.\pipe\…` — survive the text checks but are caught by step 4, because their real path is not
 * under the root, and by the `isFile` check at every call site.
 */
export async function resolveInside(root: string, rel: string): Promise<IpcResult<ResolvedPath>> {
  if (typeof rel !== 'string') return fail('Путь должен быть строкой.');
  if (rel.length > MAX_REL_CHARS) return fail('Путь неправдоподобно длинный.');
  if (CONTROL_CHARS.test(rel)) return fail('В пути есть управляющие символы.');
  if (rel.includes(':')) return fail('Двоеточие в пути внутри рабочей папки недопустимо.');
  if (isAbsolute(rel)) return fail('Ожидался путь относительно рабочей папки, а получен абсолютный.');
  if (rel.split(/[\\/]/).includes('..')) return fail('Путь выходит за пределы рабочей папки.');

  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return fail(`Рабочая папка «${root}» больше недоступна.`);
  }

  const candidate = resolve(realRoot, rel);
  if (!isInside(realRoot, candidate)) return fail('Путь выходит за пределы рабочей папки.');

  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return fail(`Внутри рабочей папки нет «${toPosix(rel)}».`);
  }
  if (!isInside(realRoot, real)) {
    return fail(`«${toPosix(rel)}» ведёт наружу рабочей папки — читать это PartyCo не будет.`);
  }

  return succeed({ absolute: real, relative: toPosix(relative(realRoot, real)), root: realRoot });
}

/* ------------------------------------------------------------------ *
 * Remembering the choice
 * ------------------------------------------------------------------ */

interface WorkspaceState {
  version: number;
  root: string;
  chosenAt: number;
}

/**
 * The remembered root: `undefined` means «not read from disk yet», `null` means «nothing chosen».
 *
 * Only the path is cached. `isGitRepo` and `branch` are recomputed on every `current()` because they
 * change while the app is closed — a cached branch is a caption that used to be true.
 */
let rootCache: string | null | undefined;

/**
 * The in-flight first read of the state file.
 *
 * Two things depend on it. Concurrent callers at startup — the renderer asks `current()` and the
 * transcript layer asks {@link currentWorkspaceRoot} in the same tick — share one read instead of
 * racing two. And, more importantly, it makes the «has a decision already been made» question
 * answerable *after* the await; see {@link rememberedRoot}.
 */
let rootLoad: Promise<string | null> | null = null;

/**
 * Record a decision that is newer than whatever is on disk.
 *
 * `choose()` and `clear()` both call this, and both must win against a read that is still in flight.
 */
function rememberInMemory(root: string | null): void {
  rootCache = root;
  rootLoad = null;
}

function stateFile(): string {
  return join(platformPaths().config, STATE_FILE);
}

/**
 * Read the remembered root, or `null`.
 *
 * A corrupt file is not a crash. This is the first thing that runs at startup, and a half-written
 * JSON — a power cut mid-save, a disk full — must not be the reason the app cannot open. Losing one
 * remembered path costs the member one click; refusing to start costs them the product.
 */
async function readState(): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFileRaw(stateFile(), 'utf8');
  } catch {
    return null; // first run, or the file was removed by hand
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const { version, root } = parsed;
  if (version !== STATE_VERSION) return null;
  if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) return null;
  return root;
}

/**
 * Rename over the old file after the new one is fully on disk.
 *
 * Writing in place is the bug this avoids: an interrupted `writeFile` leaves a truncated JSON, and
 * the next launch has neither the old value nor a valid new one. A temporary file plus `rename` is
 * atomic on both NTFS and POSIX — a reader sees the old file or the new one, never a half of either.
 * `fsync` before the rename is what makes that true after a power loss rather than only after a
 * process crash.
 */
async function writeState(root: string): Promise<void> {
  const dir = platformPaths().config;
  await mkdir(dir, { recursive: true });

  const target = join(dir, STATE_FILE);
  const temp = join(dir, `${STATE_FILE}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const state: WorkspaceState = { version: STATE_VERSION, root, chosenAt: Date.now() };

  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    // Windows fact, not superstition: an antivirus or a search indexer can hold the destination open
    // for a few milliseconds after we close it, and the rename fails with EPERM/EBUSY. Two retries
    // turn a random save failure into a save.
    await renameWithRetry(temp, target);
  } catch (cause) {
    await rm(temp, { force: true });
    throw cause;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (cause) {
      if (attempt >= 2) throw cause;
      await new Promise((done) => setTimeout(done, 25));
    }
  }
}

/**
 * The remembered root, read from disk at most once per launch.
 *
 * The `undefined` check *after* the await is not redundant with the one before it. `readState()` is
 * file I/O, and `workspace:clear` can run to completion while it is in flight: it deletes the state
 * file and sets the cache to `null`, and then the older read resolves with the path that used to be
 * there. Assigning it unconditionally — `rootCache = await readState()` — would resurrect a folder
 * the member just forgot, for the rest of the session, in the tree, the file panel and the
 * transcript alike, while `workspace.json` no longer exists to explain where it came from.
 * `choose()` racing the same read has the same shape and the same fix: a decision made in this
 * process is newer than the file, so the file never overwrites it.
 */
async function rememberedRoot(): Promise<string | null> {
  if (rootCache !== undefined) return rootCache;
  const pending: Promise<string | null> = rootLoad ?? (rootLoad = readState());
  const fromDisk = await pending;
  if (rootCache === undefined) rootCache = fromDisk;
  return rootCache;
}

/**
 * The current workspace root for other main-process code (transcripts are stored per workspace).
 *
 * Exported as a path and nothing else: a caller that wants to touch a file inside it must go through
 * {@link resolveInside} like everyone else.
 */
export async function currentWorkspaceRoot(): Promise<string | null> {
  return rememberedRoot();
}

async function requireRoot(): Promise<IpcResult<string>> {
  const root = await rememberedRoot();
  if (root === null) return fail('Рабочая папка не выбрана.');
  return succeed(root);
}

/* ------------------------------------------------------------------ *
 * Git, read as text
 * ------------------------------------------------------------------ */

/** Read at most `max` bytes of a regular file. Anything else — a device, a pipe — reads as null. */
async function readSmall(file: string, max: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return null;
    const size = Math.min(info.size, max);
    if (size === 0) return '';
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** `root/.git` as a directory (ordinary clone), as a file (worktree or submodule), or absent. */
async function gitMarker(root: string): Promise<'dir' | 'file' | null> {
  try {
    const info = await stat(join(root, '.git'));
    if (info.isDirectory()) return 'dir';
    if (info.isFile()) return 'file';
    return null;
  } catch {
    return null;
  }
}

/**
 * Where HEAD lives.
 *
 * In a clone that is `root/.git/HEAD`. In a worktree — the thing this whole product is built out of —
 * `.git` is a *file* holding `gitdir: <path>`, and HEAD lives over there. Following that pointer is
 * the difference between showing a worktree's branch and showing nothing for exactly the case that
 * matters most.
 *
 * The pointer is repository content, so it is treated as such: one level of indirection, a UNC or
 * device path refused outright (opening `\\attacker\share` makes Windows authenticate to a stranger),
 * and the destination must be a real directory before we open a file inside it.
 */
async function gitDir(root: string, marker: 'dir' | 'file'): Promise<string | null> {
  if (marker === 'dir') return join(root, '.git');

  const pointer = await readSmall(join(root, '.git'), MAX_GIT_BYTES);
  if (pointer === null) return null;

  const match = /^gitdir:\s*(.+)$/m.exec(pointer);
  const raw = match?.[1]?.trim();
  if (raw === undefined || raw.length === 0) return null;
  if (raw.startsWith('\\\\') || raw.startsWith('//')) return null;

  const resolved = resolve(root, raw);
  try {
    if (!(await stat(resolved)).isDirectory()) return null;
  } catch {
    return null;
  }
  return resolved;
}

/**
 * The branch name, or `null`.
 *
 * `null` covers both «not a repository» and detached HEAD. A detached HEAD is a commit, not a
 * branch, and printing the sha in a slot labelled «branch» would be a small lie in the place where
 * this product is trying hardest to be believed. The contract makes `branch` optional for this.
 */
async function readBranch(root: string, marker: 'dir' | 'file'): Promise<string | null> {
  const dir = await gitDir(root, marker);
  if (dir === null) return null;

  const head = await readSmall(join(dir, 'HEAD'), MAX_GIT_BYTES);
  if (head === null) return null;

  const match = /^ref:\s*refs\/heads\/(.+)$/m.exec(head);
  const branch = match?.[1]?.trim();
  if (branch === undefined || branch.length === 0) return null;
  if (branch.length > MAX_BRANCH_CHARS || CONTROL_CHARS.test(branch)) return null;
  return branch;
}

/** Everything the renderer is told about a folder. Recomputed per call — none of it is cached. */
async function describeWorkspace(root: string): Promise<WorkspaceInfo> {
  const marker = await gitMarker(root);
  const branch = marker === null ? null : await readBranch(root, marker);
  return {
    root,
    // `basename('C:\\')` is empty — a drive root is a legal, if eccentric, choice of workspace.
    name: basename(root) || root,
    isGitRepo: marker !== null,
    ...(branch === null ? {} : { branch }),
  };
}

/* ------------------------------------------------------------------ *
 * Listing one directory
 * ------------------------------------------------------------------ */

/**
 * Deterministic, case-insensitive, digit-aware: `file2` before `file10`, and the same order on every
 * machine. The code-point tiebreak exists because `sensitivity: 'base'` calls `A` and `a` equal, and
 * an unstable sort of equal keys makes the tree jump around between refreshes.
 */
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function compareNames(a: string, b: string): number {
  const primary = COLLATOR.compare(a, b);
  if (primary !== 0) return primary;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface RawEntry {
  name: string;
  kind: 'dir' | 'file';
  absolute: string;
}

/**
 * The one order the panel has: directories first, then files, each group by {@link compareNames}.
 *
 * Named rather than inlined because the page depends on it twice — once for every cut of the
 * working buffer and once at the end — and «first 2000 in display order» only means something while
 * both use the same comparison.
 */
function byDisplayOrder(a: RawEntry, b: RawEntry): number {
  return a.kind === b.kind ? compareNames(a.name, b.name) : a.kind === 'dir' ? -1 : 1;
}

/**
 * What a symlink actually points at, or `null` if we will not show it.
 *
 * A link out of the workspace is dropped from the listing rather than shown-and-then-refused: an
 * entry the member can click but never open is worse than an entry that is not there. A broken link
 * is dropped for the same reason.
 */
async function linkKind(root: string, absolute: string): Promise<'dir' | 'file' | null> {
  try {
    const real = await realpath(absolute);
    if (!isInside(root, real)) return null;
    const info = await stat(real);
    return info.isDirectory() ? 'dir' : info.isFile() ? 'file' : null;
  } catch {
    return null;
  }
}

async function fileSize(absolute: string): Promise<number | null> {
  try {
    return (await stat(absolute)).size;
  } catch {
    return null; // deleted between the listing and the stat — show the entry without a size
  }
}

/**
 * One directory, one level deep.
 *
 * Not recursive, and that is a product decision as much as a performance one. A recursive walk of a
 * real repository is tens of thousands of `stat` calls before the first pixel, on the UI's critical
 * path, for a tree the member will expand three nodes of. The renderer asks for a directory when it
 * opens one.
 *
 * `opendir` rather than `readdir` so that a pathological directory streams past us one entry at a
 * time instead of being fully materialised in memory first; {@link PRUNE_AT} is what keeps that true
 * now that every entry has to be looked at.
 *
 * A directory larger than {@link MAX_ENTRIES} is a page, not a refusal. The old answer here — «too
 * many, open a smaller folder» — was honest but it took away the whole folder because part of it did
 * not fit, and the folder somebody has to work in is the one that is too big. What the contract now
 * allows instead is showing the first page and *saying the number left out*, which is the same
 * honesty at a fraction of the cost: a truncated list that looks complete is the only answer that
 * was ever forbidden.
 *
 * `omitted` counts real entries — what a person would find in this folder and not in this panel.
 * Everything the filters drop (`.git`, `node_modules`, a socket, a symlink out of the workspace) is
 * not counted, because it was never going to be shown at any ceiling: counting it would inflate the
 * number into a claim about files that do not exist as far as this panel is concerned.
 */
async function listDirectory(target: ResolvedPath): Promise<IpcResult<Page<WorkspaceEntry>>> {
  try {
    if (!(await stat(target.absolute)).isDirectory()) {
      return fail(`«${target.relative || '.'}» — это не каталог.`);
    }
  } catch {
    return fail(`Каталог «${target.relative || '.'}» недоступен.`);
  }

  const kept: RawEntry[] = [];
  /** Entries that survived the filters — the honest denominator behind `omitted`. */
  let shown = 0;

  try {
    // The loop runs to the end even for a folder far past the ceiling: `omitted` is a count, and a
    // count nobody made is a guess. Reading names is the cheap half of listing a directory — the
    // expensive half is the `stat` below, and that is paid only for the entries that made the page.
    // A throw still closes the directory handle by itself: the async iterator's cleanup runs on the
    // way out, so there is no `close()` after this (that would double-close).
    for await (const dirent of await opendir(target.absolute)) {
      const { name } = dirent;
      if (name === '.git') continue; // plumbing, whether it is a directory or a worktree pointer

      const absolute = join(target.absolute, name);
      let kind: 'dir' | 'file' | null;
      if (dirent.isDirectory()) kind = 'dir';
      else if (dirent.isFile()) kind = 'file';
      else if (dirent.isSymbolicLink()) kind = await linkKind(target.root, absolute);
      else kind = null; // sockets, fifos, block devices — nothing a file panel can show
      if (kind === null) continue;
      if (kind === 'dir' && SKIP_DIRS.has(name.toLowerCase())) continue;

      shown += 1;
      kept.push({ name, kind, absolute });
      if (kept.length >= PRUNE_AT) {
        kept.sort(byDisplayOrder);
        kept.length = MAX_ENTRIES;
      }
    }
  } catch (cause) {
    return fail(`Не удалось прочитать каталог «${target.relative || '.'}»: ${describe(cause)}`);
  }

  kept.sort(byDisplayOrder);
  // Guarded: assigning `length` on a shorter array would *grow* it with holes, and every hole would
  // reach `Promise.all` as `undefined`.
  if (kept.length > MAX_ENTRIES) kept.length = MAX_ENTRIES;

  // Every entry of one call sits at the same level: `depth` is a property of the directory asked for.
  const depth = target.relative === '' ? 0 : target.relative.split('/').length;
  const prefix = target.relative === '' ? '' : `${target.relative}/`;

  // Sizes are read only for the entries that made the page. `stat` is the expensive part of listing
  // a directory, and paying it for entries nobody will see is how a big folder gets slow twice.
  const items = await Promise.all(
    kept.map(async (item): Promise<WorkspaceEntry> => {
      const entry: WorkspaceEntry = {
        path: `${prefix}${item.name}`,
        name: item.name,
        kind: item.kind,
        depth,
      };
      if (item.kind !== 'file') return entry;
      const size = await fileSize(item.absolute);
      return size === null ? entry : { ...entry, size };
    }),
  );

  return succeed({ items, omitted: shown - items.length });
}

/* ------------------------------------------------------------------ *
 * Reading one file
 * ------------------------------------------------------------------ */

/**
 * UTF-8 text, or a stated reason there is none.
 *
 * The three refusals are the whole point of the `reason` field in the contract. Decoding a PNG as
 * UTF-8 produces a screenful of replacement characters that looks like a corrupted file; loading
 * 200 MB of JSONL into a web page hangs the window. Both are answered with a sentence instead.
 */
async function readWorkspaceFile(target: ResolvedPath): Promise<IpcResult<WorkspaceFile>> {
  const rel = target.relative;
  if (rel === '') return fail('Это рабочая папка целиком, а не файл.');

  const cut = rel.lastIndexOf('/');
  const base = {
    path: rel,
    name: cut === -1 ? rel : rel.slice(cut + 1),
    dir: cut === -1 ? '' : rel.slice(0, cut),
  };

  let size: number;
  try {
    const info = await stat(target.absolute);
    if (info.isDirectory()) return fail(`«${rel}» — это каталог, а не файл.`);
    // Character devices, pipes and sockets reach here on both platforms (`NUL`, `CON`, `/dev/…`).
    // Reading one can block forever, so «is it a regular file» is a security check, not a nicety.
    if (!info.isFile()) return fail(`«${rel}» — не обычный файл.`);
    size = info.size;
  } catch {
    return succeed({ ...base, reason: 'unreadable' });
  }

  if (size > MAX_FILE_BYTES) return succeed({ ...base, reason: 'too-large' });

  let buffer: Buffer;
  try {
    buffer = await readFileRaw(target.absolute);
  } catch {
    return succeed({ ...base, reason: 'unreadable' });
  }
  // The file can grow between the `stat` and the read; the limit is about what we hand the renderer.
  if (buffer.byteLength > MAX_FILE_BYTES) return succeed({ ...base, reason: 'too-large' });
  if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return succeed({ ...base, reason: 'binary' });
  }

  const text = buffer.toString('utf8');
  // The byte-order mark is an encoding marker, not content: left in, it becomes an invisible first
  // character that breaks the first line of every diff and comparison downstream.
  return succeed({ ...base, text: text.startsWith('\uFEFF') ? text.slice(1) : text });
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

/**
 * Register the workspace handlers: `workspace:choose`, `workspace:current`, `workspace:clear`,
 * `workspace:tree`, `workspace:readFile`. Called once from `main/index.ts`.
 *
 * These are the five members of `WorkspaceBridge` in `preload/contracts.ts` and nothing else. There
 * is no generic «read this path» channel, because the folder picker is the only thing that widens
 * what this process will open, and it is driven by the member rather than by the renderer.
 */
export function registerWorkspaceIpc(): void {
  /**
   * The OS folder picker.
   *
   * Cancelling is `ok: true, value: null` — a member who changed their mind did not encounter an
   * error, and dressing it as one produces a red banner for a decision they made on purpose.
   */
  ipcMain.handle(
    'workspace:choose',
    async (event: IpcMainInvokeEvent): Promise<IpcResult<WorkspaceInfo | null>> => {
      const remembered = await rememberedRoot();
      const options: OpenDialogOptions = {
        title: 'Выбери папку проекта',
        buttonLabel: 'Работать здесь',
        properties: ['openDirectory'],
        ...(remembered === null ? {} : { defaultPath: remembered }),
      };

      // Parented to the window when there is one, so the sheet is modal on macOS instead of floating.
      const window = BrowserWindow.fromWebContents(event.sender);
      let picked: string | undefined;
      try {
        const result = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled) return succeed(null);
        picked = result.filePaths[0];
      } catch (cause) {
        return fail(`Не удалось открыть выбор папки: ${describe(cause)}`);
      }
      if (picked === undefined) return succeed(null);

      let root: string;
      try {
        root = await realpath(picked);
        if (!(await stat(root)).isDirectory()) return fail(`«${picked}» — это не папка.`);
      } catch {
        return fail(`Папка «${picked}» недоступна.`);
      }

      try {
        await writeState(root);
      } catch (cause) {
        // Not swallowed: accepting the folder for this session while failing to remember it means
        // the member finds a different app next launch and has no idea why.
        return fail(`Не удалось запомнить рабочую папку: ${describe(cause)}`);
      }
      rememberInMemory(root);

      return succeed(await describeWorkspace(root));
    },
  );

  /**
   * What was chosen last time.
   *
   * A remembered folder that has since been deleted, renamed or unplugged is reported as a failure
   * rather than as `null`. `null` means «nothing was ever chosen», and answering that would quietly
   * erase a decision the member made — they would see the first-run screen and wonder where their
   * project went. `clear()` and `choose()` both recover from it.
   */
  ipcMain.handle('workspace:current', async (): Promise<IpcResult<WorkspaceInfo | null>> => {
    const root = await rememberedRoot();
    if (root === null) return succeed(null);

    try {
      if (!(await stat(root)).isDirectory()) {
        return fail(`«${root}» больше не папка. Выбери рабочую папку заново.`);
      }
    } catch {
      return fail(
        `Рабочая папка «${root}» недоступна — её переименовали, удалили или отключили диск. ` +
          'Выбери папку заново.',
      );
    }

    return succeed(await describeWorkspace(root));
  });

  ipcMain.handle('workspace:clear', async (): Promise<IpcResult<null>> => {
    try {
      await rm(stateFile(), { force: true }); // already absent is the desired end state, not an error
    } catch (cause) {
      return fail(`Не удалось забыть рабочую папку: ${describe(cause)}`);
    }
    rememberInMemory(null);
    return succeed(null);
  });

  /**
   * One directory of the real tree, as a page. `dir` omitted means the root.
   *
   * `omitted > 0` is not an error and not a special case for the renderer to unwrap: the entries in
   * `items` are exactly as real as they would be in a complete listing.
   */
  ipcMain.handle(
    'workspace:tree',
    async (_event, rawDir: unknown): Promise<IpcResult<Page<WorkspaceEntry>>> => {
      if (rawDir !== undefined && rawDir !== null && typeof rawDir !== 'string') {
        return fail('Каталог должен быть строкой.');
      }
      const root = await requireRoot();
      if (!root.ok) return root;

      const target = await resolveInside(root.value, typeof rawDir === 'string' ? rawDir : '');
      if (!target.ok) return target;

      return listDirectory(target.value);
    },
  );

  ipcMain.handle(
    'workspace:readFile',
    async (_event, rawPath: unknown): Promise<IpcResult<WorkspaceFile>> => {
      if (typeof rawPath !== 'string' || rawPath.length === 0) {
        return fail('Не указан файл.');
      }
      const root = await requireRoot();
      if (!root.ok) return root;

      const target = await resolveInside(root.value, rawPath);
      if (!target.ok) return target;

      return readWorkspaceFile(target.value);
    },
  );
}
