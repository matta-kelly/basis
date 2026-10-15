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

/** One note, from its path and its text. */
export function readNote(path: string, text: string): Read {
  throw new Error(`not built: ${path} ${text}`);
}

/** Every note in a folder and the folders in it, but not in a folder whose name starts with a dot. */
export function loadFolder(
  folder: string,
): Promise<{ notes: Note[]; problems: Problem[] }> {
  throw new Error(`not built: ${folder}`);
}
