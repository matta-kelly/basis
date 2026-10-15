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
const frontmatterBlock = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One note, from its path and its text. A note with no frontmatter has an empty one. */
export function readNote(path: string, text: string): Read {
  const name = basename(path, ".md");
  const problem = (message: string): Read => ({
    ok: false,
    problem: { path, message },
  });
  const block = frontmatterBlock.exec(text);
  if (!block) {
    if (/^---\r?\n/.test(text))
      return problem("The frontmatter has no closing line of ---.");
    return { ok: true, note: { path, name, frontmatter: {}, body: text } };
  }
  const yaml = parseDocument(block[1] ?? "");
  const error = yaml.errors[0];
  if (error)
    return problem(`The frontmatter is not valid YAML: ${error.message}`);
  const frontmatter: unknown = yaml.toJS() ?? {};
  if (!isRecord(frontmatter))
    return problem("The frontmatter is not a set of fields.");
  return {
    ok: true,
    note: { path, name, frontmatter, body: text.slice(block[0].length) },
  };
}

/** The paths of the notes under a folder, from it. A file or folder whose name starts with a dot is skipped. */
async function notePaths(root: string, folder = ""): Promise<string[]> {
  const entries = await readdir(join(root, folder), { withFileTypes: true });
  const paths = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return notePaths(root, path);
        return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
      }),
  );
  return paths.flat();
}

/** Every note in a folder and the folders in it, in path order, and a problem for each note that cannot be read. */
export async function loadFolder(
  folder: string,
): Promise<{ notes: Note[]; problems: Problem[] }> {
  const paths = (await notePaths(folder)).sort();
  const reads = await Promise.all(
    paths.map(async (path) =>
      readNote(path, await readFile(join(folder, path), "utf8")),
    ),
  );
  return {
    notes: reads.flatMap((read) => (read.ok ? [read.note] : [])),
    problems: reads.flatMap((read) => (read.ok ? [] : [read.problem])),
  };
}
