/**
 * The lint: notes and a schema in, problems out. It changes nothing. The notes are checked against the schema and
 * the schemas it imports, as one set.
 * Each note is parsed by its type, and each link it writes must point at a note of the type the link points at, or of
 * a type that inherits it. No note is of an abstract type. A folder's lint also reads the type notes of each schema it
 * sees, from the folder the schema declares.
 */

import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import * as z from "zod";
import {
  byPath,
  type FolderOptions,
  loadFolder,
  type Note,
  type Problem,
} from "./loader.ts";
import {
  checked,
  keysOf,
  lineageOf,
  linksOf,
  ownTypesOf,
  schemasSeen,
  seenTypes,
  wikilink,
  type Schema,
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

/** The types a schema sees, its own and its imports', with the schema that holds each. */
type Seen = Map<string, { type: Type; owner: Schema }>;

/** The note's type, with the schema that holds it, if the schema or its imports have it. */
const noteType = (seen: Seen, note: Note) => {
  const type = note.frontmatter.type;
  return typeof type === "string" ? seen.get(type) : undefined;
};

function noteProblems(
  schema: Schema,
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
        `The type ${type} is not a type of the schema ${schema.name} or its imports.`,
      ),
    ];

  if (at.type.abstract)
    return [
      ...problems,
      problem(
        `The type ${type} is abstract: a note is of a type that inherits it.`,
      ),
    ];

  try {
    // By the schema that holds the type: a note of an imported type is that schema's.
    at.owner.parse(type, { ...note.frontmatter, name: note.name });
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    problems.push(...fieldProblems(note, error));
  }

  for (const link of linksOf(at.type)) {
    const to = link.to().map((type) => type.name);
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
        // A note with no type of the schema has that problem itself.
        targets.every((t) => noteType(seen, t)) &&
        !targets.some((t) => {
          const at = noteType(seen, t);
          const lineage = at ? lineageOf(at.type) : new Set<string>();
          return to.some((type) => lineage.has(type));
        })
      ) {
        problems.push(
          problem(
            `The link ${link.name} points at ${name}, which is a ${String(targets[0]?.frontmatter.type)}, not a ${to.join(" or a ")}.`,
          ),
        );
      }
    }
  }
  return problems;
}

/**
 * Two notes with one key: a problem on each, naming the others. A key holds over the notes of its type and of every
 * type that inherits it. Each key field is parsed by its own zod
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
  const byKey = new Map<
    string,
    { note: Note; over: string; values: string }[]
  >();
  for (const note of notes) {
    const type = noteType(seen, note)?.type;
    if (!type) continue;
    const shape = type.schema.shape;
    for (const { over, key } of keysOf(type)) {
      const parsed = z
        .object(Object.fromEntries(key.map((field) => [field, shape[field]])))
        .safeParse(note.frontmatter);
      if (!parsed.success) continue;
      const values = key.map((field) => parsed.data[field]);
      const id = [over, ...values.map(idOf)].join(" ");
      const same = byKey.get(id) ?? [];
      same.push({
        note,
        over,
        values: key
          .map((field, i) => `${field} ${JSON.stringify(values[i])}`)
          .join(", "),
      });
      byKey.set(id, same);
    }
  }
  return [...byKey.values()].flatMap((same) =>
    same.length < 2
      ? []
      : same.map(({ note, over, values }) => ({
          path: note.path,
          message: `The key ${values} of the type ${over} is also the key of ${same
            .filter((other) => other.note !== note)
            .map((other) => other.note.path)
            .join(", ")}.`,
        })),
  );
}

/**
 * What is wrong with the notes, by the schema, in path order. `unread` holds the paths of
 * notes that exist but could not be read: a link to one is not a problem, unless a read note has
 * its name, and a read note with its name is a duplicate.
 */
export function lint(
  schema: Schema,
  notes: Note[],
  unread: string[] = [],
): Problem[] {
  const unreadByName = new Map<string, string[]>();
  for (const path of unread) {
    const name = basename(path, ".md");
    unreadByName.set(name, [...(unreadByName.get(name) ?? []), path]);
  }
  const unreadNames = new Set(unreadByName.keys());
  // The schema's own check once: a note of an imported type is parsed by its own schema, not by this one.
  checked(schema);
  const seen: Seen = seenTypes<Schema>(schema);
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
    problems.push(...noteProblems(schema, seen, note, byName, unreadNames));
  problems.push(...keyProblems(seen, notes));
  return problems.sort(byPath);
}

/**
 * The notes of one folder, read as the loader reads a folder, with the folders in it left out. A folder that is not
 * there holds none.
 */
async function notesIn(folder: string) {
  try {
    return await loadFolder(folder, { skip: (path) => path.includes("/") });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { notes: [], problems: [], unread: [] };
    throw error;
  }
}

/** A path, as its real path: through each symbolic link. A path that is not there is kept. */
async function realPathOf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

const isTypeNote = (note: Note) => note.frontmatter.type === "type";

/** What is wrong with the note of one type, if it has one. */
function typeNoteProblems(
  owner: Schema,
  type: Type,
  typeNote: Note | undefined,
): string[] {
  const of = `the type ${type.name} of ${owner.name}`;
  if (!typeNote)
    return [
      `The type ${type.name} of ${owner.name} has no type note: make this note, of type type, with the description of ${type.name}.`,
    ];
  const problems: string[] = [];
  if (typeNote.frontmatter.description !== type.description)
    problems.push(
      `Its description is not the description of ${of}: make it ${JSON.stringify(type.description)}`,
    );
  const abstract = typeNote.frontmatter.abstract === true;
  if (abstract && !type.abstract)
    problems.push(
      `Its abstract is true, and ${of} is not abstract: remove abstract.`,
    );
  if (!abstract && type.abstract)
    problems.push(
      `The type ${type.name} of ${owner.name} is abstract, and its type note does not say so: add abstract: true.`,
    );
  return problems;
}

/**
 * The type notes of each schema the lint sees, read from the folder each one declares, wherever it is: each type the
 * schema owns has its note there, of type type, with its description and abstract, and each type note there explains
 * one of them. A type note outside the folder linted has the problems the lint gives a note. Each type note in the
 * folder linted is in the folder of a schema the lint sees. Folders are compared by their real paths, and each problem
 * has its path from the folder linted.
 */
async function typeNotesOf(
  schema: Schema,
  folder: string,
  linted: { notes: Note[]; problems: Problem[] },
): Promise<Problem[]> {
  const root = resolve(folder);
  const realRoot = await realPathOf(root);
  // A path in the folder linted is from it as the loader gives it; another path is from the folder as it was given.
  const from = (path: string) => {
    const inside = relative(realRoot, path);
    const at =
      inside.startsWith("..") || isAbsolute(inside)
        ? relative(root, path)
        : inside;
    return at.split(sep).join("/") || ".";
  };
  const loaded = new Set(
    [...linted.notes, ...linted.problems].map((p) => join(realRoot, p.path)),
  );
  const seen: Seen = seenTypes<Schema>(schema);
  const problems: Problem[] = [];
  const folders: string[] = [];
  const outside: Note[] = [];
  for (const owner of schemasSeen(schema)) {
    if (!owner.typeNotes) continue;
    const typesFolder = await realPathOf(
      resolve(fileURLToPath(owner.typeNotes)),
    );
    folders.push(typesFolder);
    const read = await notesIn(typesFolder);
    // A note in the folder linted has the loader's problems and the lint's already.
    const notLoaded = <P extends { path: string }>(p: P) =>
      !loaded.has(join(typesFolder, p.path));
    for (const problem of read.problems.filter(notLoaded))
      problems.push({
        ...problem,
        path: from(join(typesFolder, problem.path)),
      });
    const unread = new Set(read.unread.map((path) => basename(path, ".md")));
    const typeNotes = new Map(
      read.notes
        .filter(isTypeNote)
        .map((note) => [
          note.name,
          { ...note, path: from(join(typesFolder, note.path)) },
        ]),
    );
    outside.push(
      ...read.notes
        .filter(notLoaded)
        .map((note) => ({ ...note, path: from(join(typesFolder, note.path)) })),
    );
    const own = ownTypesOf(owner.types);
    for (const type of own) {
      if (unread.has(type.name)) continue;
      const path = from(join(typesFolder, `${type.name}.md`));
      for (const message of typeNoteProblems(
        owner,
        type,
        typeNotes.get(type.name),
      ))
        problems.push({ path, message });
    }
    for (const typeNote of typeNotes.values())
      if (!own.some((type) => type.name === typeNote.name))
        problems.push({
          path: typeNote.path,
          message: `The schema ${owner.name} has no type ${typeNote.name}: remove this type note, or give it the name of a type of ${owner.name}.`,
        });
  }
  const byName = new Map<string, Note[]>();
  for (const note of [...linted.notes, ...outside])
    byName.set(note.name, [...(byName.get(note.name) ?? []), note]);
  for (const note of outside)
    problems.push(...noteProblems(schema, seen, note, byName, new Set()));
  for (const note of linted.notes.filter(isTypeNote))
    if (!folders.includes(dirname(join(realRoot, note.path))))
      problems.push({
        path: note.path,
        message: `A type note outside the folder of the type notes of each schema the lint sees: move it to the folder of its schema, one of ${folders.map(from).join(", ")}.`,
      });
  return problems;
}

/**
 * A folder, loaded and linted, with the type notes of each schema the lint sees: the loader's problems and the lint's,
 * in path order.
 */
export async function lintFolder(
  schema: Schema,
  folder: string,
  options: FolderOptions = {},
): Promise<Problem[]> {
  const { notes, problems, unread } = await loadFolder(folder, options);
  return [
    ...problems,
    ...lint(schema, notes, unread),
    ...(await typeNotesOf(schema, folder, { notes, problems })),
  ].sort(byPath);
}
