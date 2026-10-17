/**
 * The lint: notes and a package in, problems out. It changes nothing.
 * Each note is parsed by its type, and each link it writes must point at a note of the link's `to` type.
 */

import { basename } from "node:path";
import * as z from "zod";
import { byPath, loadFolder, type Note, type Problem } from "./loader.ts";
import { wikilink, type Package } from "./primitives.ts";

/** A parse's issues as problems, one for each field. A note's name is its file name, so a bad name is a bad file name. */
function fieldProblems(note: Note, error: z.ZodError): Problem[] {
  const path = note.path;
  return error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys")
      return issue.keys.map((key) => ({
        path,
        message: `The field ${key} is not a field of its type.`,
      }));
    if (issue.path.length === 1 && issue.path[0] === "name")
      return [
        {
          path,
          message: `The file name ${note.name} is not ${issue.message}.`,
        },
      ];
    return [{ path, message: `${issue.path.join(".")}: ${issue.message}` }];
  });
}

/** The names a link holds, as the note writes it: each value that is a wikilink. A value that is not is a field problem. */
const linkNames = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).flatMap((item) => {
    const name = wikilink.safeParse(item);
    return name.success ? [name.data] : [];
  });

const hasType = (pkg: Package, note: Note) =>
  pkg.types.some((t) => t.name === note.frontmatter.type);

function noteProblems(
  pkg: Package,
  note: Note,
  byName: Map<string, Note[]>,
  unread: Set<string>,
): Problem[] {
  const problem = (message: string): Problem => ({ path: note.path, message });
  const problems: Problem[] = [];
  if (Object.hasOwn(note.frontmatter, "name"))
    problems.push(problem("The note writes name: its name is its file name."));
  const type = note.frontmatter.type;
  if (type === undefined || type === null)
    return [...problems, problem("The note has no type.")];
  if (typeof type !== "string")
    return [
      ...problems,
      problem(`The type ${JSON.stringify(type)} is not a name.`),
    ];
  if (!hasType(pkg, note))
    return [
      ...problems,
      problem(`The type ${type} is not a type of the package ${pkg.name}.`),
    ];

  try {
    pkg.parse(type, { ...note.frontmatter, name: note.name });
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    problems.push(...fieldProblems(note, error));
  }

  for (const link of pkg.links.filter((l) => l.from.name === type)) {
    for (const name of linkNames(note.frontmatter[link.name])) {
      const targets = byName.get(name);
      if (!targets) {
        // A note that could not be read exists, and has that problem itself.
        if (unread.has(name)) continue;
        problems.push(
          problem(
            `The link ${link.name} points at ${name}, which is not a note.`,
          ),
        );
      } else if (
        // A note with no type of the package has that problem itself.
        targets.every((t) => hasType(pkg, t)) &&
        !targets.some((t) => t.frontmatter.type === link.to.name)
      ) {
        problems.push(
          problem(
            `The link ${link.name} points at ${name}, which is a ${String(targets[0]?.frontmatter.type)}, not a ${link.to.name}.`,
          ),
        );
      }
    }
  }
  return problems;
}

/**
 * What is wrong with the notes, by the package, in path order. `unread` holds the paths of
 * notes that exist but could not be read: a link to one is not a problem, unless a read note has
 * its name, and a read note with its name is a duplicate.
 */
export function lint(
  pkg: Package,
  notes: Note[],
  unread: string[] = [],
): Problem[] {
  const unreadByName = new Map<string, string[]>();
  for (const path of unread) {
    const name = basename(path, ".md");
    unreadByName.set(name, [...(unreadByName.get(name) ?? []), path]);
  }
  const unreadNames = new Set(unreadByName.keys());
  const byName = new Map<string, Note[]>();
  for (const note of notes)
    byName.set(note.name, [...(byName.get(note.name) ?? []), note]);

  const problems: Problem[] = [];
  for (const [name, same] of byName) {
    for (const note of same) {
      const others = [
        ...same.filter((n) => n !== note).map((n) => n.path),
        ...(unreadByName.get(name) ?? []),
      ];
      if (others.length === 0) continue;
      problems.push({
        path: note.path,
        message: `The name ${note.name} is also the name of ${others.join(", ")}.`,
      });
    }
  }
  for (const note of notes)
    problems.push(...noteProblems(pkg, note, byName, unreadNames));
  return problems.sort(byPath);
}

/** A folder, loaded and linted: the loader's problems and the lint's, in path order. */
export async function lintFolder(
  pkg: Package,
  folder: string,
): Promise<Problem[]> {
  const { notes, problems, unread } = await loadFolder(folder);
  return [...problems, ...lint(pkg, notes, unread)].sort(byPath);
}
