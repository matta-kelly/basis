/**
 * The lint: notes and a package in, problems out. It changes nothing. The notes are checked against the package and
 * the packages it imports, as one set.
 * Each note is parsed by its type, and each link it writes must point at a note of the type the link points at.
 */

import { basename } from "node:path";
import { inspect } from "node:util";
import * as z from "zod";
import { byPath, loadFolder, type Note, type Problem } from "./loader.ts";
import {
  checked,
  linksOf,
  seenTypes,
  wikilink,
  type Package,
  type Type,
} from "./primitives.ts";

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

/** The types a package sees, its own and its imports', with the package that holds each. */
type Seen = Map<string, { type: Type; owner: Package }>;

/** The note's type, with the package that holds it, if the package or its imports have it. */
const noteType = (seen: Seen, note: Note) => {
  const type = note.frontmatter.type;
  return typeof type === "string" ? seen.get(type) : undefined;
};

function noteProblems(
  pkg: Package,
  seen: Seen,
  note: Note,
  byName: Map<string, Note[]>,
  unread: Set<string>,
): Problem[] {
  const problem = (message: string): Problem => ({ path: note.path, message });
  const problems: Problem[] = [];
  if (Object.hasOwn(note.frontmatter, "name"))
    problems.push(problem("The note writes name: its name is its file name."));
  const type = note.frontmatter.type;
  if (type === undefined || type === null || type === "")
    return [...problems, problem("The note has no type.")];
  if (typeof type !== "string")
    return [
      ...problems,
      // inspect, not JSON: a YAML alias can make a value that holds itself.
      problem(`The type ${inspect(type)} is not a name.`),
    ];
  const at = noteType(seen, note);
  if (!at)
    return [
      ...problems,
      problem(
        `The type ${type} is not a type of the package ${pkg.name} or its imports.`,
      ),
    ];

  try {
    // By the package that holds the type: a note of an imported type is that package's.
    at.owner.parse(type, { ...note.frontmatter, name: note.name });
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    problems.push(...fieldProblems(note, error));
  }

  for (const link of linksOf(at.type)) {
    const to = link.to().name;
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
        targets.every((t) => noteType(seen, t)) &&
        !targets.some((t) => t.frontmatter.type === to)
      ) {
        problems.push(
          problem(
            `The link ${link.name} points at ${name}, which is a ${String(targets[0]?.frontmatter.type)}, not a ${to}.`,
          ),
        );
      }
    }
  }
  return problems;
}

/**
 * Two notes of one type with one key: a problem on each, naming the others. Each key field is parsed by its own
 * schema, so a link is the name it points at, a note with a problem in another field is compared, and a note whose
 * key field has a problem is not: it has that problem.
 */
function keyProblems(seen: Seen, notes: Note[]): Problem[] {
  // Each value a number, by a map: a key field gives a scalar, and a map tells "1" from 1. Type names are slugs.
  const ids = new Map<unknown, number>();
  const idOf = (value: unknown) => {
    if (!ids.has(value)) ids.set(value, ids.size);
    return ids.get(value);
  };
  const byKey = new Map<string, { note: Note; values: string }[]>();
  for (const note of notes) {
    const type = noteType(seen, note)?.type;
    const key = type?.key ?? [];
    if (!type || key.length === 0) continue;
    const shape = type.schema.shape;
    const parsed = z
      .object(Object.fromEntries(key.map((field) => [field, shape[field]])))
      .safeParse(note.frontmatter);
    if (!parsed.success) continue;
    const values = key.map((field) => parsed.data[field]);
    const id = [type.name, ...values.map(idOf)].join(" ");
    const same = byKey.get(id) ?? [];
    same.push({
      note,
      values: key
        .map((field, i) => `${field} ${JSON.stringify(values[i])}`)
        .join(", "),
    });
    byKey.set(id, same);
  }
  return [...byKey.values()].flatMap((same) =>
    same.length < 2
      ? []
      : same.map(({ note, values }) => ({
          path: note.path,
          message: `The key ${values} of the type ${String(note.frontmatter.type)} is also the key of ${same
            .filter((other) => other.note !== note)
            .map((other) => other.note.path)
            .join(", ")}.`,
        })),
  );
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
  // The package's own check once: a note of an imported type is parsed by its own package, not by this one.
  checked(pkg);
  const seen: Seen = seenTypes<Package>(pkg);
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
    problems.push(...noteProblems(pkg, seen, note, byName, unreadNames));
  problems.push(...keyProblems(seen, notes));
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
