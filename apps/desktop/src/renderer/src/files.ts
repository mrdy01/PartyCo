/**
 * The files panel, over a real folder on this machine.
 *
 * The panel's row model is deliberately flat — a directory row carries its full path, the files
 * under it carry bare names, and `visibleZoneTreeRows` hides a directory's files when it is
 * collapsed. That is the shape the design drew for *zones*, and it fits a real repository without
 * being bent: a directory listing is a path followed by its files, which is the same sentence.
 *
 * What is deliberately **not** done here: nothing is painted as owned. Every row is `free` and no
 * row has a holder, because zones do not exist yet — there is no daemon handing them out and no
 * hub table recording them. Colouring a directory with somebody's identity colour would be the
 * product asserting a fact it does not have, and identity colour is the one thing in this shell a
 * person is supposed to be able to trust at a glance.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileViewerModel, ZoneTreeNode } from '@partyco/ui';
import type { WorkspaceEntry, WorkspaceFile, WorkspaceInfo } from './bridge';

export type FileTreeState = 'ready' | 'empty' | 'loading' | 'error';

export interface FileTree {
  nodes: readonly ZoneTreeNode[];
  state: FileTreeState;
  /** Which row the panel highlights. A directory path or a file path. */
  selectedId: string | undefined;
  /**
   * How many entries of a directory were **left out** of its listing, per directory.
   *
   * Not a count of what is in the panel — the opposite of it: the number that did not fit under the
   * main process's ceiling and is therefore invisible. The key is the path `tree()` takes (the root
   * is the empty string, which is what `pathOfRow` returns for the root row). A directory that is
   * absent from the map had nothing left out, so `omittedInDir.get(path) ?? 0` is the whole read.
   *
   * The panel has to state this. A listing cut short looks exactly like a complete one, and somebody
   * who cannot find a file concludes it is not there.
   */
  omittedInDir: ReadonlyMap<string, number>;
  /**
   * Those numbers added up over every directory read so far, expanded or not.
   *
   * Again, this is what is *missing*, not what is shown: `0` means everything read is complete.
   */
  omittedInTreeTotal: number;
  /**
   * Directories whose listing could not be read, and the main process's sentence about why.
   *
   * This exists because the alternative is the panel's worst lie. Expanding a directory used to be
   * unconditional: the row opened, the read failed, nothing came back, and an open directory with no
   * children under it is *exactly* how this panel draws a directory that is genuinely empty. A
   * permission wall, an unplugged drive and «здесь ничего нет» became the same picture, and the only
   * one of the three the person could act on was the one that was not true.
   *
   * So a failed read now leaves the row shut and lands here instead. Shut is honest — it says
   * nothing about the contents — but it is still silent, and silence is not the finished answer:
   * the panel has to put this sentence next to the row. Absent from the map ⇒ nothing failed.
   */
  unreadableDirs: ReadonlyMap<string, string>;
  /** Expand or collapse a directory, loading its contents the first time. */
  toggle: (path: string) => void;
  select: (id: string) => void;
  reload: () => void;
}

/**
 * One directory as it was read: its entries and how many more there were.
 *
 * The pair is kept together rather than split into two maps because they are one answer — a listing
 * whose `omitted` went missing is a listing that quietly claims to be whole. Absent from the map ⇒
 * not read yet.
 */
interface Listing {
  entries: readonly WorkspaceEntry[];
  /** Entries this directory has that are not in `entries`. `0` means the listing is complete. */
  omitted: number;
}

/**
 * The root's own row is keyed by the empty string, because that is what `tree()` takes for the root
 * and keying two things differently for one directory is how a tree ends up with two of it.
 */
const ROOT = '';

export function useFileTree(workspace: WorkspaceInfo | null): FileTree {
  const [listings, setListings] = useState<ReadonlyMap<string, Listing>>(new Map());
  const [unreadableDirs, setUnreadableDirs] = useState<ReadonlyMap<string, string>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([ROOT]));
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [state, setState] = useState<FileTreeState>('loading');
  const [nonce, setNonce] = useState(0);

  const root = workspace?.root ?? null;

  // A different folder is a different tree: keeping the old listings would show the previous
  // project's files under the new project's name for as long as the first read takes.
  useEffect(() => {
    setListings(new Map());
    setUnreadableDirs(new Map());
    setExpanded(new Set([ROOT]));
    setSelectedId(undefined);
  }, [root]);

  useEffect(() => {
    const bridge = window.partyco?.workspace;
    if (!root || !bridge) {
      setState(root ? 'error' : 'empty');
      return;
    }

    let cancelled = false;
    setState('loading');

    void bridge
      .tree()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState('error');
          return;
        }
        const page = result.value;
        setListings(new Map([[ROOT, { entries: page.items, omitted: page.omitted }]]));
        // `omitted > 0` with nothing shown is not «пусто»: the folder has entries, this answer just
        // has none of them, and the panel's own empty state would deny that.
        setState(page.items.length > 0 || page.omitted > 0 ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [root, nonce]);

  /** Undo an optimistic expansion. Written as its own callback so the failure paths cannot drift. */
  const collapse = useCallback((path: string) => {
    setExpanded((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (path: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });

      // Read once, then remember. A directory that has been opened before reopens instantly, and a
      // folder that genuinely has nothing in it stays an empty entry rather than being re-read on
      // every click.
      if (listings.has(path)) return;
      const bridge = window.partyco?.workspace;
      if (!bridge) {
        collapse(path);
        setUnreadableDirs((current) =>
          new Map(current).set(path, 'Файлы читает основной процесс, а он сейчас недоступен.'),
        );
        return;
      }
      // A retry starts from «not known to be broken»: leaving the old sentence up while the read is
      // in flight would keep accusing a folder that may well open this time.
      setUnreadableDirs((current) => {
        if (!current.has(path)) return current;
        const next = new Map(current);
        next.delete(path);
        return next;
      });
      void bridge
        .tree(path)
        .then((result) => {
          if (!result.ok) {
            // Shut, with the reason kept. Open-and-empty would be this panel's drawing of «пусто»,
            // and a folder nobody could read is not a folder anybody knows to be empty.
            collapse(path);
            setUnreadableDirs((current) => new Map(current).set(path, result.error));
            return;
          }
          const page = result.value;
          setListings((current) =>
            new Map(current).set(path, { entries: page.items, omitted: page.omitted }),
          );
        })
        .catch((cause: unknown) => {
          collapse(path);
          setUnreadableDirs((current) =>
            new Map(current).set(
              path,
              `Не удалось прочитать каталог: ${cause instanceof Error ? cause.message : String(cause)}`,
            ),
          );
        });
    },
    [collapse, listings],
  );

  const nodes = useMemo(
    () => buildRows(workspace, listings, expanded),
    [workspace, listings, expanded],
  );

  // Only the directories that actually lost something. A zero in the map would be indistinguishable
  // from a directory nobody has opened, and both would have to be read as «ничего не потеряно».
  const omittedInDir = useMemo<ReadonlyMap<string, number>>(() => {
    const cut = new Map<string, number>();
    for (const [dir, listing] of listings) {
      if (listing.omitted > 0) cut.set(dir, listing.omitted);
    }
    return cut;
  }, [listings]);

  const omittedInTreeTotal = useMemo(() => {
    let total = 0;
    for (const count of omittedInDir.values()) total += count;
    return total;
  }, [omittedInDir]);

  return {
    nodes,
    state,
    selectedId,
    omittedInDir,
    omittedInTreeTotal,
    unreadableDirs,
    toggle,
    select: setSelectedId,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}

/**
 * Directory rows in path order, each followed by its files.
 *
 * Recursion is bounded by what has actually been read: a directory nobody expanded contributes one
 * row and nothing else, so opening a repository with a hundred thousand files reads one directory.
 */
function buildRows(
  workspace: WorkspaceInfo | null,
  listings: ReadonlyMap<string, Listing>,
  expanded: ReadonlySet<string>,
): readonly ZoneTreeNode[] {
  if (!workspace) return [];
  const rows: ZoneTreeNode[] = [];

  const visit = (dir: string, label: string): void => {
    const open = expanded.has(dir);
    rows.push({
      id: dir === ROOT ? ROOT_ROW_ID : dir,
      label,
      kind: 'zone',
      state: 'free',
      expanded: open,
    });
    if (!open) return;

    const entries = listings.get(dir)?.entries ?? [];
    for (const entry of entries) {
      if (entry.kind === 'file') {
        rows.push({ id: entry.path, label: entry.name, kind: 'file', state: 'free' });
      }
    }
    for (const entry of entries) {
      if (entry.kind === 'dir') visit(entry.path, entry.path);
    }
  };

  visit(ROOT, workspace.name);
  return rows;
}

/**
 * The root row needs an id that is not the empty string.
 *
 * An empty id would make `selectedId` indistinguishable from "nothing selected" everywhere it is
 * checked, and the keyboard handler in `ZoneTree` compares ids directly.
 */
export const ROOT_ROW_ID = '.';

/** Turns a row id back into the path `tree()` and `readFile()` take. */
export function pathOfRow(id: string): string {
  return id === ROOT_ROW_ID ? ROOT : id;
}

/* ------------------------------------------------------------------ *
 * One open file
 * ------------------------------------------------------------------ */

export type OpenFileState = 'ready' | 'empty' | 'loading' | 'error';

export interface OpenFile {
  file: FileViewerModel | undefined;
  state: OpenFileState;
  /** Why there is no text, in a sentence — the refusals are not failures and do not read as red. */
  error: string | undefined;
  open: (path: string) => void;
  close: () => void;
  retry: () => void;
}

/**
 * The three refusals `readFile` can answer with, in words.
 *
 * They are not errors and the difference matters to the person reading them: the file is fine, the
 * viewer simply will not pretend that a PNG is text. Saying so plainly is the whole point — a
 * viewer that renders binary as mojibake is lying about what is in the repository.
 */
const REFUSAL: Record<NonNullable<WorkspaceFile['reason']>, string> = {
  binary: 'Это не текст — показывать нечего. Файл на месте, просто он не читается глазами.',
  'too-large': 'Файл слишком большой, чтобы открыть его целиком. Он не тронут — только не показан.',
  unreadable: 'Файл не читается: его могли переименовать или закрыть правами доступа.',
};

export function useOpenFile(workspace: WorkspaceInfo | null): OpenFile {
  const [path, setPath] = useState<string | null>(null);
  const [file, setFile] = useState<FileViewerModel | undefined>(undefined);
  const [state, setState] = useState<OpenFileState>('empty');
  const [error, setError] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const root = workspace?.root ?? null;

  useEffect(() => {
    setPath(null);
    setFile(undefined);
    setState('empty');
    setError(undefined);
  }, [root]);

  useEffect(() => {
    if (!path) return;
    const bridge = window.partyco?.workspace;
    if (!bridge) {
      setState('error');
      setError('Файлы читает основной процесс, а он сейчас недоступен.');
      return;
    }

    let cancelled = false;
    setState('loading');
    setError(undefined);

    void bridge
      .readFile(path)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setFile(undefined);
          setError(result.error);
          setState('error');
          return;
        }
        const value = result.value;
        if (value.text === undefined) {
          setFile(undefined);
          setError(value.reason ? REFUSAL[value.reason] : REFUSAL.unreadable);
          setState('error');
          return;
        }
        setFile({ name: value.name, dir: value.dir, lines: toLines(value.text) });
        setError(undefined);
        setState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setFile(undefined);
        setError('Файл не удалось прочитать.');
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  return {
    file,
    state,
    error,
    open: setPath,
    close: useCallback(() => {
      setPath(null);
      setFile(undefined);
      setState('empty');
      setError(undefined);
    }, []),
    retry: useCallback(() => setNonce((n) => n + 1), []),
  };
}

/**
 * Text to numbered lines, with no `change` on any of them.
 *
 * The viewer's diff marking stays off because nothing here computed a diff. The toggle that would
 * turn it on is not rendered either — see the note on `onToggleDiff` in `FileViewer`.
 */
function toLines(text: string): readonly { number: number; text: string }[] {
  const withoutTrailingNewline = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (withoutTrailingNewline === '') return [{ number: 1, text: '' }];
  return withoutTrailingNewline
    .split('\n')
    .map((line, index) => ({ number: index + 1, text: line.replace(/\r$/, '') }));
}
