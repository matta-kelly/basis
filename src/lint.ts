/**
 * The lint: notes and a package in, problems out. It changes nothing.
 * Each note is parsed by its type, and each link it holds must point at a note of the link's `to` type.
 */

import * as z from "zod";
import { loadFolder, type Note, type Problem } from "./loader.ts";
import type { Package } from "./primitives.ts";

const byPath = (a: Problem, b: Problem) =>
  a.path < b.path ? -1 : Number(a.path > b.path);

/** A parse's issues as problems, one for each field. */
function fieldProblems(path: string, error: z.ZodError): Problem[] {
  return error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys"
      ? issue.keys.map((key) => ({
          path,
          message: `The field ${key} is not a field of its type.`,
        }))
      : [{ path, message: `${issue.path.join(".")}: ${issue.message}` }],
  );
}

/** The names a parsed link holds: none, one, or a list. */
const linkNames = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === "string")
    : [];
};

const hasType = (pkg: Package, note: Note) =>
  pkg.types.some((t) => t.name === note.frontmatter.type);

function noteProblems(
  pkg: Package,
  note: Note,
  byName: Map<string, Note[]>,
): Problem[] {
  const problem = (message: string): Problem => ({ path: note.path, message });
  const problems: Problem[] = [];
  if (Object.hasOwn(note.frontmatter, "name"))
    problems.push(problem("The note writes name: its name is its file name."));
  const type = note.frontmatter.type;
  if (typeof type !== "string")
    return [...problems, problem("The note has no type.")];
  if (!hasType(pkg, note))
    return [
      ...problems,
      problem(`The type ${type} is not a type of the package ${pkg.name}.`),
    ];

  let parsed: Record<string, unknown>;
  try {
    parsed = pkg.parse(type, { ...note.frontmatter, name: note.name });
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    return [...problems, ...fieldProblems(note.path, error)];
  }

  for (const link of pkg.links.filter((l) => l.from.name === type)) {
    for (const name of linkNames(parsed[link.name])) {
      const targets = byName.get(name);
      if (!targets) {
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

/** What is wrong with the notes, by the package, in path order. */
export function lint(pkg: Package, notes: Note[]): Problem[] {
  const byName = new Map<string, Note[]>();
  for (const note of notes)
    byName.set(note.name, [...(byName.get(note.name) ?? []), note]);

  const problems: Problem[] = [];
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    for (const note of same) {
      const others = same.filter((n) => n !== note).map((n) => n.path);
      problems.push({
        path: note.path,
        message: `The name ${note.name} is also the name of ${others.join(", ")}.`,
      });
    }
  }
  for (const note of notes) problems.push(...noteProblems(pkg, note, byName));
  return problems.sort(byPath);
}

/** A folder, loaded and linted: the loader's problems and the lint's, in path order. */
export async function lintFolder(
  pkg: Package,
  folder: string,
): Promise<Problem[]> {
  const { notes, problems } = await loadFolder(folder);
  return [...problems, ...lint(pkg, notes)].sort(byPath);
}
