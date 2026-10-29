import { lstatSync, statSync } from "node:fs";
import { open, readdir, readFile } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { parseDocument } from "yaml";

/**
 * The loader: basis's own source. Notes in, as text, and each one out as a piece of a node. It reads, and judges nothing a
 * schema says; that is the lint's work.
 */

/**
 * One piece of a node, as the lint takes it from a source: where it is, the name of its node, the fields it gives, as
 * read, the source that gave it, and a note's body. The lint merges the pieces of one name into one node.
 */
export type Piece = {
  /** From the folder its source reads, with `/` between parts: for a lint, the root linted. */
  path: string;
  /** The name of its node: its identity. */
  name: string;
  /** Its fields, as read. The lint parses them by its type. */
  fields: Record<string, unknown>;
  /** A note's body: its prose. */
  body?: string;
  /**
   * The source that gave it: one source gives each name once. A note's is `notes`, and a note writes each link
   * "[[name]]".
   */
  source: string;
  /**
   * The name of the schema that owns it: the schema whose ground or sources gave it. None for the schema linted. Its
   * links, and the rules that see its node, resolve in that schema's composed graph.
   */
  owner?: string;
};

/**
 * One note: a piece of the source `notes`, whose name is its file name, without `.md`, and whose fields are its
 * frontmatter, with its body.
 */
export type Note = Piece & { body: string; source: "notes" };

/** A thing a source found and could not read, by its path and name. */
type NotRead = { path: string; name: string };

/**
 * What a source gives: the pieces it read, in path order, a problem for each thing it could not read, and each thing
 * it found and could not read, by its path and name. A link to one of those is not a problem: it has its own. The
 * loader's pieces and unread things name their source, notes; another source's name none.
 */
export type Loaded<
  N extends Omit<Piece, "source"> = Piece,
  U extends NotRead = NotRead,
> = {
  pieces: readonly N[];
  problems: readonly Problem[];
  unread: readonly U[];
};

/**
 * What is wrong, and where: a SARIF result's parts (ruleId, a location, message), as ESLint's LintMessage. `rule` is
 * the id of the rule that found it. `field` is the field of the node, as a JSON Pointer ("/states/0"). A path that
 * cannot be read as a node is `fatal`, of no rule, as ESLint's fatal message.
 */
export type Problem = {
  path: string;
  rule?: string;
  field?: string;
  message: string;
  fatal?: true;
};

/**
 * A source of pieces beside the notes of a folder, which a schema names: a function that gives what it read, as the loader gives a folder.
 * It gives pieces, not notes: every note is the loader's, read from the folder that holds it. Each path is from the
 * folder of the notes it is beside: its schema's folder of notes. A link is the name of the node
 * it points at. The package that knows a thing's shape writes its
 * source: basis reads no code.
 */
export type Source = () => Loaded<SourcePiece> | Promise<Loaded<SourcePiece>>;

/**
 * A piece a source gives: never a body, as a note has, and no source or owner: the lint names the source of
 * each, and its owner, the schema that names the source.
 */
export type SourcePiece = Omit<Piece, "body" | "source" | "owner"> & {
  body?: never;
  source?: never;
  owner?: never;
};

export type Read = { ok: true; note: Note } | { ok: false; problem: Problem };

// The frontmatter: YAML between a first line of `---` and the next line of `---`.
// A line of `---` can end in spaces.
const frontmatterBlock =
  /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const openingLine = /^---[ \t]*\r?\n/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One note, from its path and its text. A note with no frontmatter has an empty one. A BOM at the start is dropped. */
export function readNote(path: string, file: string): Read {
  const text = file.replace(/^\uFEFF/, "");
  const name = basename(path, ".md");
  const problem = (message: string): Read => ({
    ok: false,
    problem: { path, message, fatal: true },
  });
  const block = frontmatterBlock.exec(text);
  if (!block) {
    if (openingLine.test(text))
      return problem("The frontmatter has no closing line of ---.");
    return {
      ok: true,
      note: { path, name, fields: {}, body: text, source: "notes" },
    };
  }
  const yaml = parseDocument(block[1] ?? "");
  const error = yaml.errors[0];
  if (error)
    return problem(`The frontmatter is not valid YAML: ${error.message}`);
  let frontmatter: unknown;
  try {
    frontmatter = yaml.toJS() ?? {};
  } catch (error) {
    // The parser refuses to expand some YAML, such as an alias that expands too far.
    return problem(`The frontmatter cannot be read: ${String(error)}`);
  }
  if (!isRecord(frontmatter))
    return problem("The frontmatter is not a set of fields.");
  return {
    ok: true,
    note: {
      path,
      name,
      fields: frontmatter,
      body: text.slice(block[0].length),
      source: "notes",
    },
  };
}

/** The names a config can have, in the order they are looked for. A folder that holds one is the root of a graph. */
export const configNames = ["basis.config.ts", "basis.config.js"] as const;

/**
 * The config file of a folder, by its path, or none: the first of `configNames` that is a file there. A path that
 * cannot be looked at is none. `lintRoot` reads this config, and the walk of a ground ends at a folder that has one.
 */
export function configFileOf(folder: string): string | undefined {
  return configNames
    .map((name) => join(folder, name))
    .find((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
}

/**
 * Whether a path has a part named node_modules. Such a path is in no graph's ground, and no folder there is a root: an
 * installed package is read only through its schema's import, and a config it ships is never read.
 */
export const inNodeModules = (path: string) =>
  path.split(sep).includes("node_modules");

/**
 * Whether a path is the root of a graph: a real folder, not a symbolic link to one, that has a config file, and that is
 * not in node_modules. basis reads no symbolic link, so a link is never a root. A folder that cannot be looked at is
 * none: the loader gives its problem.
 */
export function isRoot(path: string): boolean {
  if (inNodeModules(path)) return false;
  try {
    if (!lstatSync(path).isDirectory()) return false;
  } catch {
    return false;
  }
  return configFileOf(path) !== undefined;
}

/** What a folder read leaves out, beside each file and folder whose name starts with a dot, and node_modules. */
export type FolderOptions = {
  /**
   * True for a path to leave out, as if it were not there: a file, or a folder and all in it. The path is from the
   * folder read, with `/` between parts. A folder that holds files that are not notes (a README, code) leaves them out.
   */
  skip?: (path: string) => boolean;
};

/**
 * Whether the walk of a folder leaves out a file or folder by its name: one that starts with a dot, and node_modules,
 * which is in no graph's ground. An installed package's notes are read only through its schema's import, as every Node
 * tool reads an installed copy.
 */
const outOfGround = (name: string) =>
  name.startsWith(".") || name === "node_modules";

/** The notes under a folder, by their paths from it, and a problem for each symbolic link and each folder that cannot be read. A file or folder whose name starts with a dot, node_modules, and a path `skip` names are skipped. */
async function notePaths(
  root: string,
  skip: FolderOptions["skip"],
  folder = "",
): Promise<{ paths: string[]; skipped: Problem[] }> {
  const paths: string[] = [];
  const skipped: Problem[] = [];
  let entries;
  try {
    entries = await readdir(join(root, folder), { withFileTypes: true });
  } catch (error) {
    // The folder read is the caller's: if it cannot be read, nothing can.
    if (!folder) throw error;
    skipped.push({
      path: folder,
      message: `The folder cannot be read: ${String(error)}`,
      fatal: true,
    });
    return { paths, skipped };
  }
  for (const entry of entries) {
    if (outOfGround(entry.name)) continue;
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (skip?.(path)) continue;
    if (entry.isSymbolicLink()) {
      skipped.push({
        path,
        message: "A symbolic link: basis reads only files and folders.",
        fatal: true,
      });
    } else if (entry.isDirectory()) {
      const inner = await notePaths(root, skip, path);
      paths.push(...inner.paths);
      skipped.push(...inner.skipped);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      paths.push(path);
    }
  }
  return { paths, skipped };
}

/** Orders pieces and problems by path. The loader and the lint use it, so their orders agree. */
export const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : Number(a.path > b.path);

// Fails on bytes that are not UTF-8, where a plain read would change them with no word.
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Every note in a folder and the folders in it, in path order, a problem for each note that cannot be read, and the notes found and not read, each of the source notes. The files are read one at a time. */
export async function loadFolder(
  folder: string,
  { skip }: FolderOptions = {},
): Promise<Loaded<Note, NotRead & { source: "notes" }>> {
  const { paths, skipped } = await notePaths(folder, skip);
  const pieces: Note[] = [];
  const problems = [...skipped];
  // The notes found and not read: the files, not a link or a folder.
  const unread: (NotRead & { source: "notes" })[] = [];
  const notRead = (path: string) =>
    unread.push({ path, name: basename(path, ".md"), source: "notes" });
  for (const path of paths) {
    let text: string;
    try {
      text = utf8.decode(await readFile(join(folder, path)));
    } catch (error) {
      problems.push({
        path,
        message: `The file cannot be read: ${String(error)}`,
        fatal: true,
      });
      notRead(path);
      continue;
    }
    const read = readNote(path, text);
    if (read.ok) pieces.push(read.note);
    else {
      problems.push(read.problem);
      notRead(path);
    }
  }
  return {
    pieces: pieces.sort(byPath),
    problems: problems.sort(byPath),
    unread: unread.sort(byPath),
  };
}

/** The most of a skipped file read for its frontmatter. A note's frontmatter closes long before it. */
const headBytes = 64 * 1024;

/**
 * Whether a file's frontmatter, as the loader reads it, parses and has a `type`. It reads at most the file's first
 * `headBytes`, to the end of its last whole line there: a frontmatter that does not close in them is none.
 */
async function typed(file: string): Promise<boolean> {
  let head: string;
  try {
    const handle = await open(file);
    try {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(headBytes),
        0,
        headBytes,
        0,
      );
      // A line the bound cuts is not read. A byte of \n is never inside a character of UTF-8, so no character is cut.
      const end =
        bytesRead < headBytes ? bytesRead : buffer.lastIndexOf(0x0a) + 1;
      head = utf8.decode(buffer.subarray(0, end));
    } finally {
      await handle.close();
    }
  } catch {
    // A file the loader could not read cannot say it is a note.
    return false;
  }
  const read = readNote(file, head);
  return read.ok && Object.hasOwn(read.note.fields, "type");
}

/**
 * The `.md` files under the paths `skip` names, itself or by a folder it is in, by their paths from the folder read.
 * It walks only to those paths, and a path `apart` names is not looked at.
 */
async function skippedPaths(
  root: string,
  skip: (path: string) => boolean,
  apart: (path: string) => boolean,
  folder = "",
): Promise<string[]> {
  const paths: string[] = [];
  let entries;
  try {
    entries = await readdir(join(root, folder), { withFileTypes: true });
  } catch {
    // The loader gives the problem of a folder it cannot read.
    return paths;
  }
  for (const entry of entries) {
    if (outOfGround(entry.name)) continue;
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (apart(path)) continue;
    if (!skip(path)) {
      if (entry.isDirectory())
        paths.push(...(await skippedPaths(root, skip, apart, path)));
    } else if (entry.isDirectory())
      paths.push(...(await notePaths(root, apart, path)).paths);
    else if (entry.isFile() && entry.name.endsWith(".md")) paths.push(path);
  }
  return paths;
}

/**
 * The notes a skip hides, in path order: each `.md` file under a folder that `skip` names, itself or by a folder it is
 * in, whose frontmatter, as the loader reads it, parses and has a `type`. A path `apart` names, such as a folder another
 * place reads, is not looked at. A file is read at most to its first 64 KiB.
 */
export async function hiddenNotes(
  folder: string,
  skip: (path: string) => boolean,
  apart: (path: string) => boolean,
): Promise<string[]> {
  const hidden: string[] = [];
  for (const path of await skippedPaths(folder, skip, apart))
    if (await typed(join(folder, path))) hidden.push(path);
  return hidden.sort();
}
