import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, open, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import type { IpcResult, Page, TranscriptEntry } from '../preload/contracts.ts';

/**
 * Durable conversation history: what the member and the agent actually said, on this machine, in a
 * file that survives a restart.
 *
 * The storage format is JSONL — one entry per line, appended. That choice is the whole design:
 *
 * **Append, never rewrite.** The obvious implementation keeps the transcript in memory and writes
 * the whole array on every turn. It loses the entire history when the app dies between `truncate`
 * and `write` (the window in which the file on disk is empty), and it re-serialises megabytes of
 * old turns to add one line. `appendFile` writes only the new line and can never shorten the file.
 *
 * **One line survives on its own.** A crash mid-write leaves a partial last line. A JSON *array*
 * with a partial tail is unparseable in its entirety — one interrupted write and the member's whole
 * history is gone. JSONL loses exactly the interrupted line: `load` skips what it cannot parse and
 * keeps everything before it. That rule is what makes this format worth its slightly clumsier reads.
 *
 * **Read from the end, one line at a time.** The file only grows, so the only thing that can be said
 * about its size is that a long-lived project will make it big. `readFile(file, 'utf8')` on a
 * half-gigabyte transcript does not return a large answer — it throws `ERR_STRING_TOO_LONG`, and the
 * member's entire history becomes unreadable with `clear()` as the only way out, which is to say the
 * cure is deleting the thing they came back for. So a read streams the file, parses line by line and
 * keeps the last {@link MAX_PAGE_ENTRIES} entries in a ring buffer; what came before them is counted
 * and reported as `omitted`, never deleted and never invented as a row.
 *
 * **One file per workspace, named by hash.** The file name is `sha256(normalised absolute path)`,
 * because the path itself is not a file name: `C:\code\PartyCo` carries a colon and separators, and
 * escaping it would be a scheme somebody has to keep reversible. Nothing needs to be reversible
 * here — the workspace root is always known before its transcript is wanted.
 *
 * ------------------------------------------------------------------------------------------------
 * Why `electron` and `./platform.ts` are imported dynamically rather than at the top
 *
 * `platform.ts` imports `app` from `electron`, and the npm `electron` package resolves, outside the
 * Electron runtime, to a module whose entire export is the path to a binary. A static
 * `import { ipcMain } from 'electron'` therefore makes this module unloadable by plain Node — and
 * with it, untestable without spawning an Electron process. The file logic below (naming, appending,
 * parsing, truncation, serialisation) is the part that can be wrong in ways nobody notices, so it is
 * the part that has to be reachable from `node --test`.
 *
 * The imports that need the runtime happen inside the functions that need the runtime. Registration
 * of the IPC handlers is therefore one microtask late; the window is created from
 * `app.whenReady()`, many ticks later, so no renderer can invoke a channel before it exists.
 * ------------------------------------------------------------------------------------------------
 */

/* ------------------------------------------------------------------ *
 * Bounds
 * ------------------------------------------------------------------ */

/**
 * Ceiling on one stored line.
 *
 * An agent turn can carry the contents of a file it read, and «the model printed a 40 MB buffer» is
 * a normal Tuesday. Unbounded lines make `load` an unbounded allocation on the next launch, which
 * turns one bad turn into an app that no longer starts. 256 KiB is far more prose than a person
 * reads in one bubble and still leaves the file readable.
 */
export const MAX_ENTRY_BYTES = 256 * 1024;

/**
 * Turns handed to the renderer by one `load()`.
 *
 * The end of the conversation is what a person came back for: the last thing said is the thing they
 * were reading when they closed the window, and no one scrolls to turn 1 of 9000 to resume work. So
 * the page is the tail, and the count of everything before it travels with it.
 *
 * 500 is chosen against the two failure modes at once. Below it a returning member notices the app
 * forgot a conversation they can still remember having; far above it the page stops being something
 * a window can render at all. The theoretical worst case is 500 × {@link MAX_ENTRY_BYTES}, but that
 * is the ceiling of the *format*, not of a conversation — five hundred maximum-length turns in a row
 * has never been what a transcript looks like.
 */
export const MAX_PAGE_ENTRIES = 500;

/**
 * The longest line a read will assemble before giving up on it.
 *
 * {@link fitEntry} guarantees every line this module writes fits in {@link MAX_ENTRY_BYTES}, so a
 * longer line was not written by us: it is a hand-edit, a foreign file, or garbage that happens to
 * live under this name. Buffering it anyway would hand an attacker — or a stray `cat` — the exact
 * unbounded allocation that streaming exists to prevent, so it is dropped like any other line that
 * is not an entry, and the lines around it are unaffected.
 */
const MAX_LINE_BYTES = MAX_ENTRY_BYTES;

/** `\n`. The only line separator this format has; a `\r` before it is trimmed off with whitespace. */
const NEWLINE = 0x0a;

/** `tools` is documented as «short human strings»; these caps are that documentation, enforced. */
const MAX_TOOLS = 64;
const MAX_TOOL_CHARS = 256;
const MAX_ERROR_CHARS = 4096;
const MAX_PROVIDER_ID_CHARS = 128;

/**
 * Truncation is stated inside the text, never silent.
 *
 * A transcript that quietly drops the end of an answer is a transcript that lies about what was
 * said, and the member re-reads it later looking for a sentence that the app deleted.
 */
const TEXT_CUT = `\n\n[…обрезано: запись не помещается в ${MAX_ENTRY_BYTES / 1024} КиБ]`;
const ERROR_CUT = ' […обрезано]';

/** Sub-directory under `platformPaths().data`, so the data dir does not fill with loose hashes. */
const TRANSCRIPT_DIR = 'transcripts';

/* ------------------------------------------------------------------ *
 * Small shared helpers
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

function lineBytes(entry: TranscriptEntry): number {
  return Buffer.byteLength(JSON.stringify(entry), 'utf8');
}

/** A file that was never written is an empty history, not a failure. */
function isMissing(cause: unknown): boolean {
  const code = isRecord(cause) ? cause['code'] : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/* ------------------------------------------------------------------ *
 * Naming: workspace root → file
 * ------------------------------------------------------------------ */

/**
 * The form of a path that two launches must agree on.
 *
 * `C:\code\PartyCo`, `C:\code\PartyCo\` and `c:\code\partyco` are one folder, and a member who
 * opened the second on Tuesday expects Monday's history. Trailing separators go, and on Windows —
 * where the filesystem is case-insensitive — case goes too. On POSIX case is significant and is
 * kept: `/srv/App` and `/srv/app` really are two folders there.
 *
 * Relative paths are refused rather than resolved against `process.cwd()`: the cwd of the main
 * process is not a stable thing to hash, and the same relative path would silently address two
 * different histories in dev and in a packaged app.
 */
export function normalizeRoot(root: string): string {
  if (typeof root !== 'string' || root.trim().length === 0) {
    throw new TypeError('Путь рабочей папки должен быть непустой строкой.');
  }
  if (!isAbsolute(root)) {
    throw new TypeError(`Путь рабочей папки должен быть абсолютным, а получено «${root}».`);
  }
  const absolute = resolvePath(root);
  // `resolve` already collapses `..`, doubled separators and mixed slashes; only a trailing one can
  // survive, and only when the path is not a bare root like `C:\` or `/`.
  const trimmed = absolute.replace(/[\\/]+$/, '') || absolute;
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/** `<sha256 of the normalised root>.jsonl`. Stable across launches, opaque, always a legal name. */
export function transcriptFileName(root: string): string {
  return `${createHash('sha256').update(normalizeRoot(root), 'utf8').digest('hex')}.jsonl`;
}

/** Where this workspace's transcript lives under a given data directory. */
export function transcriptFilePath(dataDir: string, root: string): string {
  return join(dataDir, TRANSCRIPT_DIR, transcriptFileName(root));
}

/* ------------------------------------------------------------------ *
 * What may be stored
 * ------------------------------------------------------------------ */

/** The half of an entry a caller supplies; `id` and `at` are this module's to assign. */
export type TranscriptInput = Omit<TranscriptEntry, 'id' | 'at'>;

const ROLES: readonly TranscriptEntry['role'][] = ['member', 'agent'];

/**
 * Turn whatever arrived — from the renderer, over IPC — into an entry, or into the reason it is not
 * one.
 *
 * Only the fields named in the contract are copied out. Storing an arbitrary object would let the
 * least trusted part of the app decide what the history file contains, and `load` would hand that
 * back to it as if this process had vouched for it.
 */
export function sanitizeEntry(raw: unknown): IpcResult<TranscriptInput> {
  if (!isRecord(raw)) return fail('Некорректная запись: ожидался объект.');

  const { role, text, tools, error, cancelled, providerId } = raw;

  if (typeof role !== 'string' || !ROLES.includes(role as TranscriptEntry['role'])) {
    return fail('Роль записи должна быть «member» или «agent».');
  }
  if (text !== undefined && typeof text !== 'string') return fail('Текст записи должен быть строкой.');
  if (error !== undefined && typeof error !== 'string') return fail('Ошибка записи должна быть строкой.');
  if (cancelled !== undefined && typeof cancelled !== 'boolean') {
    return fail('Признак отмены должен быть булевым.');
  }
  if (providerId !== undefined && typeof providerId !== 'string') {
    return fail('Идентификатор провайдера должен быть строкой.');
  }
  // Coercing here (`String(tool)`) would store `[object Object]` as a tool name — a row in the
  // transcript that claims the agent ran something it never ran. Refusing is the honest answer.
  let toolList: string[] | undefined;
  if (tools !== undefined) {
    if (!Array.isArray(tools) || tools.some((tool: unknown) => typeof tool !== 'string')) {
      return fail('Список инструментов должен быть массивом строк.');
    }
    toolList = [...(tools as string[])];
  }

  return succeed({
    role: role as TranscriptEntry['role'],
    ...(text === undefined ? {} : { text }),
    ...(toolList === undefined ? {} : { tools: toolList }),
    ...(error === undefined ? {} : { error }),
    ...(cancelled === undefined ? {} : { cancelled }),
    ...(providerId === undefined ? {} : { providerId }),
  });
}

/** Identity and wall-clock are assigned here, never accepted from a caller. */
function stamp(input: TranscriptInput): TranscriptEntry {
  return { id: randomUUID(), at: Date.now(), ...input };
}

/** Bound everything that is not prose, so the prose gets the whole remaining budget. */
function capFields(entry: TranscriptEntry): TranscriptEntry {
  const tools = entry.tools;
  const cappedTools =
    tools === undefined
      ? undefined
      : [
          ...tools.slice(0, MAX_TOOLS).map((tool) =>
            tool.length > MAX_TOOL_CHARS ? tool.slice(0, MAX_TOOL_CHARS) + '…' : tool,
          ),
          ...(tools.length > MAX_TOOLS ? [`…ещё ${tools.length - MAX_TOOLS}`] : []),
        ];

  const error =
    entry.error !== undefined && entry.error.length > MAX_ERROR_CHARS
      ? entry.error.slice(0, MAX_ERROR_CHARS) + ERROR_CUT
      : entry.error;

  const providerId =
    entry.providerId !== undefined && entry.providerId.length > MAX_PROVIDER_ID_CHARS
      ? entry.providerId.slice(0, MAX_PROVIDER_ID_CHARS)
      : entry.providerId;

  return {
    id: entry.id,
    at: entry.at,
    role: entry.role,
    ...(entry.text === undefined ? {} : { text: entry.text }),
    ...(cappedTools === undefined ? {} : { tools: cappedTools }),
    ...(error === undefined ? {} : { error }),
    ...(entry.cancelled === undefined ? {} : { cancelled: entry.cancelled }),
    ...(providerId === undefined ? {} : { providerId }),
  };
}

/**
 * Make one entry fit one line.
 *
 * The budget is measured on the serialised line, not on the text, because JSON escaping is what
 * actually decides the size: a payload of quotes and newlines doubles on the way to disk. So the
 * loop asks the same question the filesystem will («how many bytes is this line?») and cuts until
 * the answer is small enough. Every pass shortens the text strictly, so it terminates on any input;
 * the guard is a second lock on that, not the mechanism.
 */
export function fitEntry(entry: TranscriptEntry): TranscriptEntry {
  const capped = capFields(entry);
  if (lineBytes(capped) <= MAX_ENTRY_BYTES) return capped;

  const text = capped.text;
  // Nothing left to cut: `capFields` already bounds every other field to a few kilobytes together,
  // so this branch is unreachable in practice and is here to be honest rather than clever.
  if (text === undefined) return capped;

  let keep = text.length;
  for (let guard = 0; guard < 64; guard += 1) {
    const candidate: TranscriptEntry = { ...capped, text: text.slice(0, keep) + TEXT_CUT };
    const size = lineBytes(candidate);
    if (size <= MAX_ENTRY_BYTES || keep === 0) return candidate;

    // Scale rather than subtract. The overshoot is in bytes and `keep` counts characters, and the
    // two are not the same number: Cyrillic is two bytes per character, so subtracting the byte
    // overshoot from a character count throws away twice what it should — a 2 MB Russian answer
    // would come back as nothing but the truncation marker. The ratio holds whatever the encoding,
    // and the extra few characters cover the fixed part of the line.
    let next = Math.floor((keep * MAX_ENTRY_BYTES) / size) - 8;
    // A ratio can stall when the fixed overhead dominates; force progress so the loop terminates.
    if (next >= keep) next = keep - Math.ceil(keep / 8);
    keep = Math.max(0, next);
  }
  return { ...capped, text: TEXT_CUT };
}

/**
 * One stored line back into an entry, or `null` if the line is not one.
 *
 * Half-written, hand-edited and future-version lines all land here, and all three answer the same
 * way: this line is not history, the ones around it still are.
 */
function parseStoredLine(line: string): TranscriptEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;

  const { id, at } = raw;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;

  const rest = sanitizeEntry(raw);
  if (!rest.ok) return null;

  return { id, at, ...rest.value };
}

/* ------------------------------------------------------------------ *
 * One file at a time
 * ------------------------------------------------------------------ */

/**
 * Per-file promise chain.
 *
 * Two turns can end at the same moment — the member sends while the agent's answer lands — and two
 * `appendFile` calls in flight against one path are two writes whose order the OS chooses. Ordering
 * is the least of it: a `load` interleaved with a write can read the file between the bytes of a
 * line and drop a turn that was written correctly. Chaining every operation on a path makes the
 * file's contents a function of the order operations were requested in.
 *
 * The chain continues through failures (`then(task, task)`): one failed append must not wedge every
 * later write on that file.
 */
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(file: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail: Promise<unknown> = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(file, tail);
  // Drop the entry once this operation is the last one on the file, so a long-lived process does
  // not keep a promise per folder it ever touched.
  void tail.then(() => {
    if (queues.get(file) === tail) queues.delete(file);
  });
  return result;
}

/* ------------------------------------------------------------------ *
 * The file logic, with the directory as a parameter
 *
 * These three take `dataDir` explicitly so the whole storage layer can be exercised against a
 * temporary folder by `node --test`, with no Electron and no user profile involved.
 * ------------------------------------------------------------------ */

/**
 * Read the file line by line, keeping either all of it (`limit === null`) or the last `limit`
 * entries, and count what was left behind.
 *
 * Three properties are worth stating because each of them is a bug that was available here:
 *
 * **Nothing whole is ever held in memory.** The stream arrives in chunks the size the OS chose, one
 * line is assembled at a time, and the retained set never exceeds `limit` entries. That is what
 * makes a 500 MB transcript readable at all — and it is why the file is read forwards even though
 * the answer is its tail. Reading backwards in blocks would touch fewer bytes, but `omitted` has to
 * be a count of *entries*, and whether a line is an entry is only knowable by parsing it. Any honest
 * count therefore visits the whole file, at which point going backwards buys nothing and costs the
 * one thing that matters here — a reader anybody can check.
 *
 * **A broken line is not an entry, so it is not omitted either.** It is not counted, not returned
 * and not represented by anything. Counting damage as history would make `omitted` a number the
 * interface states in words and cannot back up.
 *
 * **Nothing synthetic is spliced in.** No «здесь обрезано» row: a transcript is a record of what was
 * said, and a line nobody said has no business in it. The count travels beside the entries instead.
 */
async function readEntries(file: string, limit: number | null): Promise<Page<TranscriptEntry>> {
  /** The kept entries. Once it is full, `next` is both the write position and the oldest one. */
  const ring: TranscriptEntry[] = [];
  let next = 0;
  let total = 0;

  const take = (line: Buffer): void => {
    // `trim` handles CRLF files and stray whitespace; a blank line is not a broken one.
    const text = line.toString('utf8').trim();
    if (text.length === 0) return;
    const entry = parseStoredLine(text);
    if (entry === null) return;

    total += 1;
    if (limit === null || ring.length < limit) {
      ring.push(entry);
      return;
    }
    ring[next] = entry;
    next = (next + 1) % limit;
  };

  /** Bytes of the line being assembled, or `null` between lines. */
  let carry: Buffer | null = null;
  /** Set when the current line passed {@link MAX_LINE_BYTES}: drop bytes until the next newline. */
  let skipping = false;

  const stream: AsyncIterable<Buffer> = createReadStream(file);
  try {
    for await (const chunk of stream) {
      let offset = 0;
      while (offset < chunk.length) {
        const at = chunk.indexOf(NEWLINE, offset);
        const end = at === -1 ? chunk.length : at;

        if (!skipping) {
          const piece = chunk.subarray(offset, end);
          if ((carry === null ? 0 : carry.length) + piece.length > MAX_LINE_BYTES) {
            carry = null;
            skipping = true;
          } else {
            // The copy matters: `createReadStream` slices its chunks out of a shared pool, and a
            // subarray kept across iterations pins — or in a future Node, could outlive — that pool.
            carry = carry === null ? Buffer.from(piece) : Buffer.concat([carry, piece]);
          }
        }

        if (at === -1) break; // the line continues in the next chunk
        if (carry !== null) take(carry);
        carry = null;
        skipping = false;
        offset = at + 1;
      }
    }
  } catch (cause) {
    if (isMissing(cause)) return { items: [], omitted: 0 };
    throw cause;
  }
  // A file that ends without a newline: the last append was interrupted, or an editor saved it that
  // way. Whatever it is, it gets the same chance to be an entry as any other line.
  if (carry !== null) take(carry);

  // `next` is non-zero only while the ring is mid-lap, so this is the only unrolling needed.
  const items = next === 0 ? ring : [...ring.slice(next), ...ring.slice(0, next)];
  return { items, omitted: total - items.length };
}

/**
 * Everything stored for this workspace, oldest first. Broken lines are skipped, not fatal.
 *
 * Deliberately *not* a page — see {@link loadTranscript} for who asks for all of it and why.
 */
export async function loadTranscriptFrom(
  dataDir: string,
  root: string,
): Promise<readonly TranscriptEntry[]> {
  const file = transcriptFilePath(dataDir, root);
  return serialized(file, async () => (await readEntries(file, null)).items);
}

/**
 * The last `limit` entries and the number of older ones, for a screen.
 *
 * `limit` is a parameter so that tests can ask for a small page without writing a large history;
 * callers in the app take the default. A non-finite or non-positive value falls back to the default
 * rather than being obeyed — a page of zero entries would be an empty history that is not empty.
 */
export async function loadTranscriptPageFrom(
  dataDir: string,
  root: string,
  limit: number = MAX_PAGE_ENTRIES,
): Promise<Page<TranscriptEntry>> {
  const file = transcriptFilePath(dataDir, root);
  const bounded = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : MAX_PAGE_ENTRIES;
  return serialized(file, () => readEntries(file, bounded));
}

/**
 * Does the file end in the middle of a line?
 *
 * It does exactly when the process died mid-append last time — the case JSONL is chosen to survive.
 * Surviving it means the *next* append must start a line of its own: written straight after the
 * fragment it would fuse with it, and one unparseable line would then swallow a good entry as well
 * as the broken one. Two syscalls once per turn is a cheap price for that not happening.
 */
async function endsMidLine(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch (cause) {
    if (isMissing(cause)) return false;
    throw cause;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    const { bytesRead } = await handle.read(last, 0, 1, size - 1);
    return bytesRead === 1 && last[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

/** Append one entry. Returns exactly what was written, id, timestamp and truncation included. */
export async function appendTranscriptTo(
  dataDir: string,
  root: string,
  entry: TranscriptInput,
): Promise<TranscriptEntry> {
  const clean = sanitizeEntry(entry);
  if (!clean.ok) throw new TypeError(clean.error);

  const stored = fitEntry(stamp(clean.value));
  const file = transcriptFilePath(dataDir, root);
  const line = `${JSON.stringify(stored)}\n`;

  await serialized(file, async () => {
    await mkdir(dirname(file), { recursive: true });
    const prefix = (await endsMidLine(file)) ? '\n' : '';
    await appendFile(file, prefix + line, 'utf8');
  });
  return stored;
}

/** Start over. A missing file is already «started over», so removal is enough and never errors. */
export async function clearTranscriptIn(dataDir: string, root: string): Promise<void> {
  const file = transcriptFilePath(dataDir, root);
  await serialized(file, async () => {
    await rm(file, { force: true });
  });
}

/* ------------------------------------------------------------------ *
 * The same three, against this machine's data directory
 * ------------------------------------------------------------------ */

/**
 * Overridable for tests — and only for tests. Passing a directory here keeps `platform.ts`, and
 * therefore `electron`, out of the module graph entirely.
 */
let dataDirOverride: string | null = null;

export function setTranscriptDataDir(dir: string | null): void {
  dataDirOverride = dir;
}

async function transcriptDataDir(): Promise<string> {
  if (dataDirOverride !== null) return dataDirOverride;
  const { platformPaths } = await import('./platform.ts');
  return platformPaths().data;
}

/**
 * Direct main-process API, deliberately not routed through IPC.
 *
 * A turn started in `main/agents.ts` will want to write its own result — the renderer should not
 * have to echo the agent's answer back across the bridge for it to be stored. The dependency runs
 * one way: this module knows nothing about `agents.ts`, and `agents.ts` may import these.
 */
/**
 * Everything, not a page — and that is the decision, not an oversight.
 *
 * `Page` exists to answer a question a *screen* has: «is this all of it, and if not, how much am I
 * not looking at». The main process has no screen and nobody to tell. What it has is a different
 * job: assembling the context of a run, where the unit of «too much» is tokens and the right thing
 * to drop is decided by whoever builds the prompt — a ceiling of 500 rows chosen for a scroll view
 * would silently amputate that decision, and `omitted: 4212` would be a number with no reader.
 *
 * So this returns the entries and lets the caller bound them by its own measure. It is safe to do
 * now in a way it was not before: the read streams, so a huge file is slow rather than fatal, and
 * nothing here materialises the file as one string.
 *
 * A caller that genuinely wants the screen's answer — a future «continue where we left off» — asks
 * {@link loadTranscriptPage}.
 */
export async function loadTranscript(root: string): Promise<readonly TranscriptEntry[]> {
  return loadTranscriptFrom(await transcriptDataDir(), root);
}

/** The page `transcript:load` answers with. Same storage, bounded from the start. */
export async function loadTranscriptPage(
  root: string,
  limit?: number,
): Promise<Page<TranscriptEntry>> {
  return loadTranscriptPageFrom(await transcriptDataDir(), root, limit);
}

export async function appendTranscript(
  root: string,
  entry: TranscriptInput,
): Promise<TranscriptEntry> {
  return appendTranscriptTo(await transcriptDataDir(), root, entry);
}

export async function clearTranscript(root: string): Promise<void> {
  return clearTranscriptIn(await transcriptDataDir(), root);
}

/* ------------------------------------------------------------------ *
 * Which workspace «this workspace» is
 * ------------------------------------------------------------------ */

/**
 * `TranscriptBridge` has no `root` parameter on purpose: the renderer does not get to name the
 * folder whose history it reads. The main process knows which workspace is open and answers for
 * that one — the same rule `main/agents.ts` applies to the working directory of a run.
 *
 * How it learns: whoever owns the workspace hands it over, either once at registration
 * (`registerTranscriptIpc(() => currentWorkspace()?.root ?? null)`) or on every change
 * (`setTranscriptWorkspace(root)`). Until then there is no workspace, and «нет рабочей папки» is
 * the truthful answer rather than a history invented for a folder nobody opened.
 */
export type WorkspaceRootSource = () => string | null | Promise<string | null>;

let currentRoot: string | null = null;
let rootSource: WorkspaceRootSource = () => currentRoot;

/** Tell the transcript layer which folder is open. `null` when the member cleared the workspace. */
export function setTranscriptWorkspace(root: string | null): void {
  currentRoot = root;
}

async function requireRoot(): Promise<IpcResult<string>> {
  let root: string | null;
  try {
    root = await rootSource();
  } catch (cause) {
    return fail(describe(cause));
  }
  if (typeof root !== 'string' || root.trim().length === 0) {
    return fail('Рабочая папка не выбрана — историю разговора негде хранить.');
  }
  if (!isAbsolute(root)) {
    return fail(`Путь рабочей папки должен быть абсолютным, а получен «${root}».`);
  }
  return succeed(root);
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

/** `ipcMain.handle` throws on a second registration of the same channel. */
let registered = false;

/**
 * Register `transcript:load`, `transcript:append` and `transcript:clear`. Called once from
 * `main/index.ts`.
 *
 * @param source optional resolver for the current workspace root. Omit it and the module uses
 *   whatever `setTranscriptWorkspace` was last told.
 */
export function registerTranscriptIpc(source?: WorkspaceRootSource): void {
  if (source !== undefined) rootSource = source;
  if (registered) return;
  registered = true;

  // See the header: `electron` cannot be a static import here without making this module — and its
  // file logic — unloadable outside the Electron runtime.
  void import('electron')
    .then(({ ipcMain }) => {
      /**
       * The tail of the conversation and the size of what precedes it.
       *
       * A long history is no longer a reason to answer with an error: `ok: false` here means the
       * file could not be read at all, not that there was too much of it.
       */
      ipcMain.handle('transcript:load', async (): Promise<IpcResult<Page<TranscriptEntry>>> => {
        const root = await requireRoot();
        if (!root.ok) return root;
        try {
          return succeed(await loadTranscriptPage(root.value));
        } catch (cause) {
          return fail(`Не удалось прочитать историю разговора: ${describe(cause)}`);
        }
      });

      ipcMain.handle(
        'transcript:append',
        async (_event, raw: unknown): Promise<IpcResult<TranscriptEntry>> => {
          const entry = sanitizeEntry(raw);
          if (!entry.ok) return entry;
          const root = await requireRoot();
          if (!root.ok) return root;
          try {
            return succeed(await appendTranscript(root.value, entry.value));
          } catch (cause) {
            return fail(`Не удалось записать историю разговора: ${describe(cause)}`);
          }
        },
      );

      ipcMain.handle('transcript:clear', async (): Promise<IpcResult<null>> => {
        const root = await requireRoot();
        if (!root.ok) return root;
        try {
          await clearTranscript(root.value);
          return succeed(null);
        } catch (cause) {
          return fail(`Не удалось очистить историю разговора: ${describe(cause)}`);
        }
      });
    })
    .catch((cause: unknown) => {
      registered = false;
      // Nothing in the renderer can report this — the channels it would report on are the ones that
      // failed to appear — so it goes to the process's own output.
      process.stderr.write(`transcript: не удалось зарегистрировать IPC: ${describe(cause)}\n`);
    });
}
