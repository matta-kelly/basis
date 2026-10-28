import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseDocument } from "yaml";

/**
 * The loader: basis's own source. Notes in, as text, and each one out as a piece of a node. It reads, and judges nothing a
 * schema says; that is the lint's work.
 */

/**
 * One piece of a node, as the lint takes it from a source: where it is, the name of its node, the fields it gives, as
 * read, and a note's body. The lint merges the pieces of one name into one node.
 */
export type Piece = {
  /** From the folder its source reads, with `/` between parts: for a lint, the folder linted. */
  path: string;
  /** The name of its node: its identity. */
  name: string;
  /** Its fields, as read. The lint parses them by its type. */
  fields: Record<string, unknown>;
  /** Its body, if it is a note: a note writes each link "[[name]]". */
  body?: string;
  /** The source that gave it, when the lint knows it: one source gives each name once. The loader's are notes. */
  source?: string;
};

/** One note: a piece whose name is its file name, without `.md`, and whose fields are its frontmatter, with its body. */
export type Note = Piece & { body: string };

/**
 * What a source gives: the pieces it read, in path order, a problem for each thing it could not read, and each thing
 * it found and could not read, by its path and name. A link to one of those is not a problem: it has its own.
 */
export type Loaded<N extends Piece = Piece> = {
  pieces: readonly N[];
  problems: readonly Problem[];
  unread: readonly { path: string; name: string }[];
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
 * A source of pieces beside the notes of a folder, which a schema or a folder's lint names: a function that gives what it read, as the loader gives a folder.
 * It gives pieces, not notes: every note is the loader's, read from the folder that holds it. Each path is from the
 * folder of the notes it is beside: its schema's folder of notes, or the folder linted. A link is the name of the node
 * it points at. The package that knows a thing's shape writes its
 * source: basis reads no code.
 */
export type Source = () => Loaded<SourcePiece> | Promise<Loaded<SourcePiece>>;

/** A piece a source gives: never a body, as a note has. */
type SourcePiece = Omit<Piece, "body" | "source"> & {
  body?: never;
  source?: never;
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
    return { ok: true, note: { path, name, fields: {}, body: text } };
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
    },
  };
}

/** What a folder read leaves out, beside each file and folder whose name starts with a dot. */
export type FolderOptions = {
  /**
   * True for a path to leave out, as if it were not there: a file, or a folder and all in it. The path is from the
   * folder read, with `/` between parts. A folder that holds files that are not notes (a README, code) leaves them out.
   */
  skip?: (path: string) => boolean;
};

/** The notes under a folder, by their paths from it, and a problem for each symbolic link and each folder that cannot be read. A file or folder whose name starts with a dot is skipped, and so is a path `skip` names. */
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
    if (entry.name.startsWith(".")) continue;
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

/** Every note in a folder and the folders in it, in path order, a problem for each note that cannot be read, and the notes found and not read. The files are read one at a time. */
export async function loadFolder(
  folder: string,
  { skip }: FolderOptions = {},
): Promise<Loaded<Note>> {
  const { paths, skipped } = await notePaths(folder, skip);
  const pieces: Note[] = [];
  const problems = [...skipped];
  // The notes found and not read: the files, not a link or a folder.
  const unread: { path: string; name: string }[] = [];
  const notRead = (path: string) =>
    unread.push({ path, name: basename(path, ".md") });
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
