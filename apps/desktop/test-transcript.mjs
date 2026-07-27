/**
 * Storage checks for the conversation transcript.
 *
 * Every case here is a way the history can be lost or made up without anything failing loudly: a
 * half-written line taking the whole file down on the next launch, two turns landing at once and
 * shredding each other, a 40 MB model answer becoming a file nobody can load, `clear` leaving the
 * old history behind. None of those surface as an error at the moment they happen — they surface
 * as a member reopening a project and finding the conversation gone or wrong.
 *
 * Nothing here needs Electron: the storage layer takes its directory as a parameter, so the same
 * assertions run against a temp folder on a laptop and on a bare CI runner.
 *
 * Run: node --test apps/desktop/test-transcript.mjs
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MAX_ENTRY_BYTES,
  appendTranscript,
  appendTranscriptTo,
  clearTranscript,
  clearTranscriptIn,
  fitEntry,
  loadTranscript,
  loadTranscriptFrom,
  normalizeRoot,
  sanitizeEntry,
  setTranscriptDataDir,
  transcriptFileName,
  transcriptFilePath,
} from './src/main/transcript.ts';

/** @type {string[]} */
const tempDirs = [];

/** A throwaway stand-in for `platformPaths().data`. */
function dataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partyco-transcript-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * A workspace root. It never has to exist on disk — the transcript is addressed by the *hash* of
 * the path, not by anything inside the folder.
 *
 * Built with `path.join` so it is absolute on whichever platform runs the test.
 */
function workspaceRoot(name) {
  return path.join(os.tmpdir(), 'partyco-workspaces', name);
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * Naming
 * ------------------------------------------------------------------ */

test('the file name is a hash of the path, not the path', () => {
  const root = workspaceRoot('proj');
  const name = transcriptFileName(root);

  assert.match(name, /^[0-9a-f]{64}\.jsonl$/);
  // Whatever else it is, it must be a legal file name on Windows: no colon, no separator.
  assert.ok(!name.includes(':'));
  assert.ok(!name.includes(path.sep));
  assert.equal(transcriptFileName(root), name, 'the same folder must map to the same file twice');
  assert.notEqual(transcriptFileName(workspaceRoot('other')), name);
});

test('the same folder written differently is the same transcript', () => {
  const root = workspaceRoot('proj');

  // A trailing separator is what a path picker or a config file adds; it is not a different folder.
  assert.equal(transcriptFileName(root + path.sep), transcriptFileName(root));

  if (process.platform === 'win32') {
    // Windows filesystems are case-insensitive: `C:\Code\App` and `c:\code\app` are one folder, and
    // a member who typed the second one expects the history of the first.
    assert.equal(transcriptFileName(root.toUpperCase()), transcriptFileName(root.toLowerCase()));
  }
});

test('a relative path is refused rather than resolved against the cwd', () => {
  // Resolving against `process.cwd()` would give a dev run and a packaged run two different
  // histories for the same words.
  assert.throws(() => normalizeRoot('some/folder'), /абсолютным/);
  assert.throws(() => normalizeRoot(''), /непустой/);
});

/* ------------------------------------------------------------------ *
 * Appending
 * ------------------------------------------------------------------ */

test('entries are appended and read back oldest first', async () => {
  const dir = dataDir();
  const root = workspaceRoot('append');

  const first = await appendTranscriptTo(dir, root, { role: 'member', text: 'привет' });
  const second = await appendTranscriptTo(dir, root, {
    role: 'agent',
    text: 'здравствуй',
    tools: ['чтение файла'],
    providerId: 'anthropic',
  });

  assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.id, second.id);
  assert.equal(typeof first.at, 'number');
  assert.ok(first.at > 0);

  const loaded = await loadTranscriptFrom(dir, root);
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded[0], first, 'append returns exactly what was stored');
  assert.deepEqual(loaded[1], second);
  assert.deepEqual(loaded[1].tools, ['чтение файла']);
  assert.equal(loaded[1].providerId, 'anthropic');
});

test('appending grows the file instead of rewriting it', async () => {
  const dir = dataDir();
  const root = workspaceRoot('grow');
  const file = transcriptFilePath(dir, root);

  await appendTranscriptTo(dir, root, { role: 'member', text: 'первое' });
  const afterFirst = fs.readFileSync(file, 'utf8');

  await appendTranscriptTo(dir, root, { role: 'member', text: 'второе' });
  const afterSecond = fs.readFileSync(file, 'utf8');

  // A `writeFile` of the accumulated array would pass a length check and still be the bug: the
  // point is that the earlier bytes were never touched.
  assert.ok(afterSecond.startsWith(afterFirst), 'the earlier lines must be the same bytes');
  assert.equal(afterSecond.trimEnd().split('\n').length, 2);
});

test('a workspace with no file has an empty history, not an error', async () => {
  const dir = dataDir();
  assert.deepEqual(await loadTranscriptFrom(dir, workspaceRoot('never-used')), []);
});

test('two workspaces do not share a history', async () => {
  const dir = dataDir();
  const a = workspaceRoot('a');
  const b = workspaceRoot('b');

  await appendTranscriptTo(dir, a, { role: 'member', text: 'из A' });
  await appendTranscriptTo(dir, b, { role: 'member', text: 'из B' });

  const loadedA = await loadTranscriptFrom(dir, a);
  const loadedB = await loadTranscriptFrom(dir, b);
  assert.equal(loadedA.length, 1);
  assert.equal(loadedB.length, 1);
  assert.equal(loadedA[0].text, 'из A');
  assert.equal(loadedB[0].text, 'из B');
});

/* ------------------------------------------------------------------ *
 * Damaged files
 * ------------------------------------------------------------------ */

test('a broken line is skipped and the rest of the history survives', async () => {
  const dir = dataDir();
  const root = workspaceRoot('damaged');
  const file = transcriptFilePath(dir, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  fs.writeFileSync(
    file,
    [
      JSON.stringify({ id: 'a', at: 1, role: 'member', text: 'первая' }),
      'это вообще не JSON',
      JSON.stringify({ id: 'b', at: 2 }), // no role — not an entry
      '', // blank line
      '   ',
      JSON.stringify({ id: 'c', at: 'вчера', role: 'agent', text: 'плохая метка времени' }),
      JSON.stringify({ id: 'd', at: 4, role: 'agent', text: 'третья' }),
      '{"id":"e","at":5,"role":"agent","text":"обор', // killed mid-write, no newline
    ].join('\n'),
    'utf8',
  );

  const loaded = await loadTranscriptFrom(dir, root);
  assert.equal(loaded.length, 2, 'exactly the two intact lines');
  assert.deepEqual(
    loaded.map((entry) => entry.text),
    ['первая', 'третья'],
  );

  // And the file is still writable afterwards: a damaged tail is not a dead transcript.
  const added = await appendTranscriptTo(dir, root, { role: 'member', text: 'после поломки' });
  const reloaded = await loadTranscriptFrom(dir, root);
  assert.equal(reloaded.length, 3);
  assert.equal(reloaded[2].id, added.id);
});

test('a CRLF file still loads', async () => {
  const dir = dataDir();
  const root = workspaceRoot('crlf');
  const file = transcriptFilePath(dir, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ id: 'a', at: 1, role: 'member', text: 'строка' })}\r\n`,
    'utf8',
  );

  const loaded = await loadTranscriptFrom(dir, root);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].text, 'строка');
});

/* ------------------------------------------------------------------ *
 * Concurrency
 * ------------------------------------------------------------------ */

test('parallel appends do not shred each other', async () => {
  const dir = dataDir();
  const root = workspaceRoot('parallel');
  const file = transcriptFilePath(dir, root);

  // Big enough that a naive read-modify-write, or two unordered writes, would leave a torn line:
  // small payloads can be written atomically by the OS and would hide the bug.
  const count = 24;
  const filler = 'я'.repeat(100_000);
  const written = await Promise.all(
    Array.from({ length: count }, (_unused, index) =>
      appendTranscriptTo(dir, root, { role: 'member', text: `${index}:${filler}` }),
    ),
  );

  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, count, 'one line per append, no more and no fewer');
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), 'every line must be whole');
  }

  const loaded = await loadTranscriptFrom(dir, root);
  assert.equal(loaded.length, count);
  assert.deepEqual(
    new Set(loaded.map((entry) => entry.id)),
    new Set(written.map((entry) => entry.id)),
    'every append that resolved is in the file exactly once',
  );
  for (const entry of loaded) {
    const [index] = entry.text.split(':');
    assert.equal(entry.text, `${index}:${filler}`, 'no line borrowed bytes from another');
  }
});

test('a load requested during appends sees whole lines only', async () => {
  const dir = dataDir();
  const root = workspaceRoot('read-while-writing');
  const filler = 'ц'.repeat(50_000);

  const work = [];
  for (let index = 0; index < 8; index += 1) {
    work.push(appendTranscriptTo(dir, root, { role: 'agent', text: `${index}:${filler}` }));
    work.push(loadTranscriptFrom(dir, root));
  }
  const results = await Promise.all(work);

  // The last load is queued behind every append before it, so it must see all of them.
  const last = results[results.length - 1];
  assert.equal(last.length, 8);
  for (const entry of last) assert.ok(entry.text.endsWith(filler));
});

/* ------------------------------------------------------------------ *
 * Size
 * ------------------------------------------------------------------ */

test('an oversized entry is truncated, and says so', async () => {
  const dir = dataDir();
  const root = workspaceRoot('huge');
  const file = transcriptFilePath(dir, root);

  const huge = 'ю'.repeat(2_000_000); // ~4 MB once encoded, ~8× the ceiling
  const stored = await appendTranscriptTo(dir, root, { role: 'agent', text: huge });

  assert.ok(stored.text.length < huge.length, 'the text was cut');
  assert.match(stored.text, /обрезано/, 'and the cut is stated in the text, not hidden');
  assert.ok(
    stored.text.startsWith('ю'.repeat(1000)),
    'the beginning is kept — the end is what gets dropped',
  );

  const line = fs.readFileSync(file, 'utf8').trimEnd();
  assert.ok(
    Buffer.byteLength(line, 'utf8') <= MAX_ENTRY_BYTES,
    `stored line is ${Buffer.byteLength(line, 'utf8')} bytes, ceiling is ${MAX_ENTRY_BYTES}`,
  );

  const loaded = await loadTranscriptFrom(dir, root);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].text, stored.text, 'what append returned is what reload gives back');
});

test('escaping is counted, not the character length', () => {
  // A payload of quotes doubles on the way to disk: 200_000 quotes is 200 KB of source and 400 KB
  // of JSON. Measuring the entry instead of the line would let this one through.
  const entry = fitEntry({ id: 'x', at: 1, role: 'agent', text: '"'.repeat(200_000) });
  assert.ok(Buffer.byteLength(JSON.stringify(entry), 'utf8') <= MAX_ENTRY_BYTES);
  assert.match(entry.text, /обрезано/);
});

test('an entry that is small enough is stored byte for byte', () => {
  const text = 'обычный ответ агента';
  const entry = fitEntry({ id: 'x', at: 1, role: 'agent', text, tools: ['bash: ls'] });
  assert.equal(entry.text, text, 'nothing is marked as truncated when nothing was truncated');
  assert.deepEqual(entry.tools, ['bash: ls']);
});

test('a runaway tool list is bounded and admits it', () => {
  const entry = fitEntry({
    id: 'x',
    at: 1,
    role: 'agent',
    tools: Array.from({ length: 500 }, (_unused, index) => `инструмент ${index}`),
  });
  assert.ok(entry.tools.length < 500);
  assert.match(entry.tools[entry.tools.length - 1], /ещё \d+/);
});

/* ------------------------------------------------------------------ *
 * Clearing
 * ------------------------------------------------------------------ */

test('clear starts the transcript over', async () => {
  const dir = dataDir();
  const root = workspaceRoot('clear');

  await appendTranscriptTo(dir, root, { role: 'member', text: 'до очистки' });
  await appendTranscriptTo(dir, root, { role: 'agent', text: 'и ещё одно' });
  assert.equal((await loadTranscriptFrom(dir, root)).length, 2);

  await clearTranscriptIn(dir, root);
  assert.deepEqual(await loadTranscriptFrom(dir, root), [], 'nothing is left behind');

  const added = await appendTranscriptTo(dir, root, { role: 'member', text: 'после очистки' });
  const loaded = await loadTranscriptFrom(dir, root);
  assert.equal(loaded.length, 1, 'a cleared transcript still accepts new turns');
  assert.equal(loaded[0].id, added.id);
  assert.equal(loaded[0].text, 'после очистки');
});

test('clearing a transcript that was never written is not an error', async () => {
  const dir = dataDir();
  await clearTranscriptIn(dir, workspaceRoot('never-written'));
});

test('clear does not touch another workspace', async () => {
  const dir = dataDir();
  const kept = workspaceRoot('kept');
  const dropped = workspaceRoot('dropped');

  await appendTranscriptTo(dir, kept, { role: 'member', text: 'останется' });
  await appendTranscriptTo(dir, dropped, { role: 'member', text: 'исчезнет' });
  await clearTranscriptIn(dir, dropped);

  assert.equal((await loadTranscriptFrom(dir, kept)).length, 1);
  assert.deepEqual(await loadTranscriptFrom(dir, dropped), []);
});

/* ------------------------------------------------------------------ *
 * What may be stored
 * ------------------------------------------------------------------ */

test('only the contract fields are stored, and id and at are ours', async () => {
  const dir = dataDir();
  const root = workspaceRoot('fields');

  const stored = await appendTranscriptTo(dir, root, {
    role: 'member',
    text: 'вопрос',
    // Not part of the contract, and arriving from the least trusted process in the app.
    id: 'подделанный-id',
    at: 0,
    admin: true,
    __proto__: { polluted: true },
  });

  assert.notEqual(stored.id, 'подделанный-id');
  assert.ok(stored.at > 0);
  assert.equal(stored.admin, undefined);

  const raw = JSON.parse(fs.readFileSync(transcriptFilePath(dir, root), 'utf8').trim());
  assert.deepEqual(Object.keys(raw).sort(), ['at', 'id', 'role', 'text']);
});

test('a malformed entry is refused with a sentence', () => {
  assert.equal(sanitizeEntry(null).ok, false);
  assert.equal(sanitizeEntry({ role: 'кто-то' }).ok, false);
  assert.equal(sanitizeEntry({ role: 'member', text: 42 }).ok, false);
  assert.equal(sanitizeEntry({ role: 'member', tools: [{ name: 'bash' }] }).ok, false);
  assert.equal(sanitizeEntry({ role: 'member', cancelled: 'да' }).ok, false);

  const refusal = sanitizeEntry({ role: 'нет такой роли' });
  assert.equal(refusal.ok, false);
  assert.ok(refusal.error.length > 0);

  const accepted = sanitizeEntry({ role: 'agent', cancelled: true, error: 'прервано' });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.value, { role: 'agent', cancelled: true, error: 'прервано' });
});

/* ------------------------------------------------------------------ *
 * The main-process API, on the same storage
 * ------------------------------------------------------------------ */

test('the direct API writes where the IPC handlers read', async () => {
  const dir = dataDir();
  const root = workspaceRoot('direct');
  setTranscriptDataDir(dir);
  try {
    const written = await appendTranscript(root, { role: 'agent', text: 'из main-процесса' });
    const loaded = await loadTranscript(root);
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], written);

    // And it is the same file the directory-taking functions use — one storage, two entry points.
    assert.deepEqual(await loadTranscriptFrom(dir, root), loaded);

    await clearTranscript(root);
    assert.deepEqual(await loadTranscript(root), []);
  } finally {
    setTranscriptDataDir(null);
  }
});
