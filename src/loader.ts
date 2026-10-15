import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseDocument } from "yaml";

/**
 * The loader: notes in, as text, and each one out as data. It reads, and judges nothing a
 * package says; that is the lint's work.
 */

/** One note: where it is, its name, and what it says. */
export type Note = {
  /** From the folder read, with `/` between parts. */
  path: string;
  /** The file name, without `.md`. A node's name. */
  name: string;
  frontmatter: Record<string, unknown>;
  body: string;
};

/** A note that could not be read, and why. */
export type Problem = { path: string; message: string };

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
    problem: { path, message },
  });
  const block = frontmatterBlock.exec(text);
  if (!block) {
    if (openingLine.test(text))
      return problem("The frontmatter has no closing line of ---.");
    return { ok: true, note: { path, name, frontmatter: {}, body: text } };
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
    note: { path, name, frontmatter, body: text.slice(block[0].length) },
  };
}

/** The notes under a folder, by their paths from it, and a problem for each symbolic link. A file or folder whose name starts with a dot is skipped. */
async function notePaths(
  root: string,
  folder = "",
): Promise<{ paths: string[]; links: Problem[] }> {
  const entries = await readdir(join(root, folder), { withFileTypes: true });
  const paths: string[] = [];
  const links: Problem[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      links.push({
        path,
        message: "A symbolic link: basis reads only files and folders.",
      });
    } else if (entry.isDirectory()) {
      const inner = await notePaths(root, path);
      paths.push(...inner.paths);
      links.push(...inner.links);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      paths.push(path);
    }
  }
  return { paths, links };
}

/** Every note in a folder and the folders in it, in path order, and a problem for each note that cannot be read. The files are read one at a time. */
export async function loadFolder(
  folder: string,
): Promise<{ notes: Note[]; problems: Problem[] }> {
  const { paths, links } = await notePaths(folder);
  const notes: Note[] = [];
  const problems = [...links];
  for (const path of paths) {
    let text: string;
    try {
      text = await readFile(join(folder, path), "utf8");
    } catch (error) {
      problems.push({
        path,
        message: `The file cannot be read: ${String(error)}`,
      });
      continue;
    }
    const read = readNote(path, text);
    if (read.ok) notes.push(read.note);
    else problems.push(read.problem);
  }
  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : Number(a.path > b.path);
  return { notes: notes.sort(byPath), problems: problems.sort(byPath) };
}
