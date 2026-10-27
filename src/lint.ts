/**
 * The lint: pieces and a schema in, problems out. It changes nothing. The pieces of one name are merged into one node,
 * and the nodes are checked against the schema and the schemas it imports, as one set.
 * Each node is parsed by its type, and each link it writes must point at a node of the type the link points at, or of
 * a type that inherits it. No node is of an abstract type. A folder's lint also reads the type notes of each schema it
 * sees, from the folder the schema declares.
 */

import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import * as z from "zod";
import {
  byPath,
  type FolderOptions,
  type Loaded,
  loadFolder,
  type Piece,
  type Problem,
} from "./loader.ts";
import {
  checked,
  checkRules,
  isOfType,
  keysOf,
  lineageOf,
  linksOf,
  Name,
  ownTypesOf,
  rulesSeen,
  schemasSeen,
  seesType,
  seenTypes,
  noteSchemaOf,
  Wikilink,
  type Graph,
  type Schema,
  type Type,
} from "./primitives.ts";

/**
 * The rules of basis itself: a closed list, exported here, each by its id, under the schema name basis, which no other
 * schema can take. An id, once released, keeps its name. A piece that cannot be read is fatal, and of no rule.
 */
export const coreRules = Object.freeze([
  {
    id: "basis/name",
    description:
      "A node's name is a lowercase slug, and is not one of its fields.",
  },
  {
    id: "basis/unique-name",
    description: "No two nodes have one name.",
  },
  {
    id: "basis/merge",
    description: "Each field of a node comes from one of its pieces.",
  },
  {
    id: "basis/type",
    description:
      "A node has a type, one the schema or its imports have, and not an abstract one.",
  },
  {
    id: "basis/fields",
    description: "A node's fields are the fields of its type, and fit them.",
  },
  {
    id: "basis/link",
    description:
      "Each link points at a node, of the type the link points at or of a type that inherits it.",
  },
  {
    id: "basis/key",
    description: "No two nodes of a type have one key.",
  },
  {
    id: "basis/type-note",
    description:
      "Each type a schema owns has its type note, in the folder the schema declares.",
  },
  {
    id: "basis/type-note-agrees",
    description:
      "A type note has its type's description, and abstract: true when its type is abstract.",
  },
  {
    id: "basis/type-note-type",
    description:
      "Each type note in a schema's folder explains a type of that schema.",
  },
  {
    id: "basis/type-note-folder",
    description:
      "Each type note sits in the folder of type notes of a schema the lint sees.",
  },
] as const);

/** The id of a rule of basis. */
type CoreRule = (typeof coreRules)[number]["id"];

/** A field of a node, as a JSON Pointer (RFC 6901): "/states/0". A "~" in a key is "~0", and a "/" is "~1". */
export const pointer = (path: readonly PropertyKey[]): string =>
  path
    .map(
      (part) => `/${String(part).replaceAll("~", "~0").replaceAll("/", "~1")}`,
    )
    .join("");

/** The keys of a JSON Pointer, or none when it is not one. */
const pointerKeys = (field: string): string[] | undefined =>
  field.startsWith("/")
    ? field
        .slice(1)
        .split("/")
        .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    : undefined;

/** The value at a path in the fields, or undefined when there is none. */
const valueAt = (fields: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>(
    (value, key) =>
      typeof value === "object" && value !== null
        ? (value as Record<PropertyKey, unknown>)[key]
        : undefined,
    fields,
  );

/** Whether a piece is a note: it has a body. Its name is its file name, and it writes each link "[[name]]". */
const isNote = (piece: Piece) => typeof piece.body === "string";

/**
 * One node: the pieces of one name, merged. Its fields are those of every piece, each as its piece writes it, with the
 * piece that gives it. A problem of a field is on the piece that gives the field, and a problem of the whole node on
 * its path: its note's, or, with no note, its first piece's.
 */
type Node = {
  name: string;
  /** Its pieces, in path order. */
  pieces: readonly Piece[];
  path: string;
  fields: Record<string, unknown>;
  /** The piece that gives each field. */
  from: ReadonlyMap<string, Piece>;
};

/** Where a problem of a field of a node is: on the piece that gives it, or, when no piece does, on the node's path. */
const pathOf = (node: Node, field: PropertyKey | undefined) =>
  (field === undefined ? undefined : node.from.get(String(field)))?.path ??
  node.path;

/** What a name's problem adds for a node with a note: its name is its file name. A source's piece has no file name. */
const fileName = (node: Node) =>
  node.pieces.some(isNote) ? " A note's name is its file name." : "";

/**
 * Things in an order no input order changes: by path, and things of one path by their fields. inspect, not JSON: a
 * YAML alias can make a value that holds itself.
 */
const canonical = <T extends { path: string; name: string; fields: object }>(
  things: readonly T[],
): T[] => {
  const text = new Map(
    things.map((thing) => [
      thing,
      inspect(thing.fields, { depth: Infinity, sorted: true }),
    ]),
  );
  return [...things].sort((a, b) => {
    const at = byPath(a, b);
    if (at !== 0) return at;
    const [x = "", y = ""] = [text.get(a), text.get(b)].map(
      (fields, i) => `${String((i === 0 ? a : b).name)} ${fields}`,
    );
    return x < y ? -1 : Number(x > y);
  });
};

/**
 * One node from pieces of one name, and the problems of its merge: a field two pieces give is a problem on each, and
 * the node takes it from the first. Every piece names the type: the node's is its path's piece's.
 */
function mergeOne(pieces: readonly Piece[]): {
  node: Node;
  problems: Problem[];
} {
  const sorted = canonical(pieces);
  const first = sorted[0];
  if (!first) throw new Error("A node has at least one piece.");
  const home = sorted.find(isNote) ?? first;
  // No prototype: a field named __proto__ is a field, kept, and checked as any other.
  const fields: Record<string, unknown> = Object.create(null);
  const from = new Map<string, Piece>();
  const givers = new Map<string, Piece[]>();
  if (Object.hasOwn(home.fields, "type")) {
    fields.type = home.fields.type;
    from.set("type", home);
  }
  for (const piece of sorted)
    for (const [field, value] of Object.entries(piece.fields)) {
      if (field === "type") continue;
      givers.set(field, [...(givers.get(field) ?? []), piece]);
      if (from.has(field)) continue;
      fields[field] = value;
      from.set(field, piece);
    }
  const problems = [...givers].flatMap(([field, by]) =>
    by.length < 2
      ? []
      : by.map((piece): Problem => ({
          path: piece.path,
          rule: "basis/merge",
          field: pointer([field]),
          message: `Also given by ${by
            .filter((other) => other !== piece)
            .map((other) => other.path)
            .join(
              ", ",
            )}: each field comes from one piece. Remove it from all but one.`,
        })),
  );
  return {
    node: { name: first.name, pieces: sorted, path: home.path, fields, from },
    problems,
  };
}

/**
 * The pieces, merged into nodes by name, with the problems of each merge. The pieces of one name that all name one
 * type, each from another source (the folder's notes are one), are one node. Otherwise each piece is a node of its
 * own, and the nodes share a name.
 */
function mergeAll(pieces: readonly Piece[]): {
  nodes: Node[];
  problems: Problem[];
} {
  const byName = new Map<string, Piece[]>();
  for (const piece of pieces)
    byName.set(piece.name, [...(byName.get(piece.name) ?? []), piece]);
  const nodes: Node[] = [];
  const problems: Problem[] = [];
  for (const same of [...byName.keys()]
    .sort()
    .map((name) => byName.get(name) ?? [])) {
    // A source gives each name once, as a folder holds one note of a name: two of one source are two things.
    const sources = same.flatMap((piece) =>
      isNote(piece)
        ? ["notes"]
        : piece.source === undefined
          ? []
          : [piece.source],
    );
    const apart =
      new Set(sources).size < sources.length ||
      new Set(same.map((piece) => piece.fields.type)).size > 1;
    for (const group of apart ? same.map((piece) => [piece]) : [same]) {
      const merged = mergeOne(group);
      nodes.push(merged.node);
      problems.push(...merged.problems);
    }
  }
  return { nodes: canonical(nodes), problems };
}

/** For each node, its schema as its pieces write it: a link from a note a wikilink, and from another piece a name. */
const nodeSchemas = new WeakMap<Node, z.ZodObject>();

function schemaOf(type: Type, node: Node): z.ZodObject {
  const had = nodeSchemas.get(node);
  if (had) return had;
  const notes = node.pieces.filter(isNote).length;
  const fromNote = linksOf(type).filter((link) => {
    const piece = node.from.get(link.name);
    return piece !== undefined && isNote(piece);
  });
  const schema =
    notes === node.pieces.length
      ? noteSchemaOf(type)
      : fromNote.length === 0
        ? type.schema
        : type.schema.extend(
            Object.fromEntries(
              fromNote.map((link) => [
                link.name,
                noteSchemaOf(type).shape[link.name],
              ]),
            ),
          );
  nodeSchemas.set(node, schema);
  return schema;
}

/** A parse's issues as problems, one for each field, each on the piece that gives the field. A bad name is a problem of the name. */
function fieldProblems(node: Node, error: z.ZodError): Problem[] {
  return error.issues.flatMap((issue): Problem[] => {
    if (issue.code === "unrecognized_keys")
      return issue.keys.map((key) => ({
        path: pathOf(node, issue.path[0] ?? key),
        rule: "basis/fields",
        field: pointer([...issue.path, key]),
        message: "Not a field of its type: remove it, or add it to the type.",
      }));
    if (issue.path.length === 1 && issue.path[0] === "name")
      return [
        {
          path: node.path,
          rule: "basis/name",
          message: `The name ${node.name} is not a lowercase slug.${fileName(node)}`,
        },
      ];
    // A field the node does not have, whatever zod's code for it: what its type needs there is the fix.
    const missing =
      issue.path.length > 0 && valueAt(node.fields, issue.path) === undefined;
    const needed =
      issue.code === "invalid_type"
        ? `a ${issue.expected}`
        : issue.code === "invalid_value"
          ? `one of ${issue.values.map((value) => JSON.stringify(value)).join(", ")}`
          : "a value";
    return [
      {
        path: pathOf(node, issue.path[0]),
        rule: "basis/fields",
        ...(issue.path.length > 0 && { field: pointer(issue.path) }),
        message: missing
          ? `Missing: its type needs ${needed} here.`
          : issue.message,
      },
    ];
  });
}

/**
 * The names a link holds, each value read as its piece writes one name: a wikilink in a note, a name in another piece.
 * A value that is not one is a field problem.
 */
function linkNames(node: Node, field: string): string[] {
  const piece = node.from.get(field);
  const item = piece && isNote(piece) ? Wikilink : Name;
  const value = node.fields[field];
  return (Array.isArray(value) ? value : [value]).flatMap((one) => {
    const name = item.safeParse(one);
    return name.success ? [name.data] : [];
  });
}

/** The types a schema sees, its own and its imports', with the schema that holds each. */
type Seen = Map<string, { type: Type; owner: Schema }>;

/** The node's type, with the schema that holds it, if the schema or its imports have it. */
const nodeType = (seen: Seen, node: { fields: Record<string, unknown> }) => {
  const type = node.fields.type;
  return typeof type === "string" ? seen.get(type) : undefined;
};

function nodeProblems(
  schema: Schema,
  seen: Seen,
  node: Node,
  byName: Map<string, Node[]>,
  unread: Set<string>,
  parsed?: Map<Node, unknown>,
): Problem[] {
  const problem = (
    rule: CoreRule,
    field: string,
    message: string,
  ): Problem => ({
    path: pathOf(node, field),
    rule,
    field: pointer([field]),
    message,
  });
  const problems: Problem[] = [];
  if (Object.hasOwn(node.fields, "name"))
    problems.push(
      problem(
        "basis/name",
        "name",
        `Its name is not one of its fields.${fileName(node)} Remove it.`,
      ),
    );
  const type = node.fields.type;
  if (type === undefined || type === null || type === "")
    return [
      ...problems,
      problem("basis/type", "type", "The node has no type."),
    ];
  if (typeof type !== "string")
    return [
      ...problems,
      // inspect, not JSON: a YAML alias can make a value that holds itself.
      problem("basis/type", "type", `The type ${inspect(type)} is not a name.`),
    ];
  const at = nodeType(seen, node);
  if (!at)
    return [
      ...problems,
      problem(
        "basis/type",
        "type",
        `The type ${type} is not a type of the schema ${schema.name} or its imports.`,
      ),
    ];

  if (at.type.abstract)
    return [
      ...problems,
      problem(
        "basis/type",
        "type",
        `The type ${type} is abstract: a node is of a type that inherits it.`,
      ),
    ];

  try {
    // By the type the schema sees, as its pieces write it: a node of an imported type is of that type.
    const value = schemaOf(at.type, node).parse({
      ...node.fields,
      name: node.name,
    });
    // A copy: the caller's fields stay as they were, and stay theirs.
    parsed?.set(node, deepFreeze(structuredClone(value)));
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    problems.push(...fieldProblems(node, error));
  }

  for (const link of linksOf(at.type)) {
    const to = link.to().map((type) => type.name);
    for (const name of linkNames(node, link.name)) {
      const targets = byName.get(name);
      if (!targets) {
        // A piece that could not be read exists, and has that problem itself.
        if (unread.has(name)) continue;
        problems.push(
          problem(
            "basis/link",
            link.name,
            `It points at ${name}, which is not a node.`,
          ),
        );
      } else if (
        // A node with no type of the schema has that problem itself.
        targets.every((t) => nodeType(seen, t)) &&
        !targets.some((t) => {
          const at = nodeType(seen, t);
          const lineage = at ? lineageOf(at.type) : new Set<string>();
          return to.some((type) => lineage.has(type));
        })
      ) {
        problems.push(
          problem(
            "basis/link",
            link.name,
            `It points at ${name}, which is a ${String(targets[0]?.fields.type)}, not a ${to.join(" or a ")}.`,
          ),
        );
      }
    }
  }
  return problems;
}

/**
 * Two nodes with one key: a problem on each, naming the others. A key holds over the nodes of its type and of every
 * type that inherits it. Each key field is parsed by its own zod
 * schema, so a link is the name it points at, a node with a problem in another field is compared, and a node whose
 * key field has a problem is not: it has that problem.
 */
function keyProblems(seen: Seen, nodes: readonly Node[]): Problem[] {
  // Each value a number, by a map: a key field gives a scalar, and a map tells "1" from 1. Type names are slugs.
  const ids = new Map<unknown, number>();
  const idOf = (value: unknown) => {
    if (!ids.has(value)) ids.set(value, ids.size);
    return ids.get(value);
  };
  const byKey = new Map<
    string,
    { node: Node; over: string; key: readonly string[]; values: string }[]
  >();
  for (const node of nodes) {
    const type = nodeType(seen, node)?.type;
    if (!type) continue;
    const shape = schemaOf(type, node).shape;
    for (const { over, key } of keysOf(type)) {
      const parsed = z
        .object(Object.fromEntries(key.map((field) => [field, shape[field]])))
        .safeParse(node.fields);
      if (!parsed.success) continue;
      const values = key.map((field) => parsed.data[field]);
      const id = [over, ...values.map(idOf)].join(" ");
      const same = byKey.get(id) ?? [];
      same.push({
        node,
        over,
        key,
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
      : same.map(({ node, over, key, values }) => ({
          path: key.length === 1 ? pathOf(node, key[0]) : node.path,
          rule: "basis/key",
          ...(key.length === 1 && { field: pointer(key) }),
          message: `The key ${values} of the type ${over} is also the key of ${same
            .filter((other) => other.node !== node)
            .map((other) => other.node.path)
            .join(", ")}.`,
        })),
  );
}

/** What a rule gives for each thing wrong: the field it is in, if one, and the message. */
const Report = z.strictObject({
  field: z.string().min(1).optional(),
  message: z.string().min(1),
});

/** A value, frozen through its arrays and objects, so a rule cannot change what the next one reads. A Date is not frozen by this. */
function deepFreeze<V>(value: V): V {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

/**
 * What the rules of each schema the lint sees find wrong: each rule runs on each node of its type that parsed, and
 * each `{ field?, message }` it gives is a problem of rule `<schema>/<rule>`, on the piece that gives the field. A check
 * that throws, or gives something other than a list of `{ field?, message }`, is a fault of the rule, not of the node:
 * the lint throws, naming both.
 */
function ruleProblems(
  schema: Schema,
  seen: Seen,
  parsed: Map<Node, unknown>,
  byName: Map<string, Node[]>,
  unread: Set<string>,
): Problem[] {
  const isOf = (node: Node, type: Type) => {
    const at = nodeType(seen, node);
    return at !== undefined && isOfType(at.type, type);
  };
  const nodes = [...parsed].sort(([a], [b]) => byPath(a, b));
  const ofType = new Map<Type, [Node, unknown][]>();
  const nodesOf = (type: Type) => {
    if (!ofType.has(type))
      ofType.set(
        type,
        nodes.filter(([node]) => isOf(node, type)),
      );
    return ofType.get(type) ?? [];
  };
  // A type the schema does not see is a fault of the rule that reads it: the check throws, and the lint names it.
  const seenType = (type: Type) => {
    if (!seesType(seen, type))
      throw new Error(
        `The type ${type.name} is not a type of the schema ${schema.name} or its imports.`,
      );
    return type;
  };
  const graph: Graph = {
    get: (name, type) => {
      seenType(type);
      const same = byName.get(name);
      const only =
        same?.length === 1 && !unread.has(name) ? same[0] : undefined;
      return only && parsed.has(only) && isOf(only, type)
        ? (parsed.get(only) as never)
        : undefined;
    },
    all: (type) => nodesOf(seenType(type)).map(([, value]) => value as never),
  };
  const problems: Problem[] = [];
  for (const { rule, owner } of rulesSeen(schema)) {
    const id = `${owner.name}/${rule.name}`;
    for (const [node, value] of nodesOf(rule.on)) {
      let reports: unknown;
      try {
        reports = rule.check(value as never, graph);
      } catch (error) {
        throw new Error(
          `The rule ${id} threw on ${node.path}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const parsedReports = Report.array().safeParse(reports);
      if (!parsedReports.success)
        throw new Error(
          `The rule ${id} gave something other than a list of { field?, message } for ${node.path}.`,
        );
      const type = nodeType(seen, node)?.type;
      for (const { field, message } of parsedReports.data) {
        const head = field === undefined ? undefined : pointerKeys(field)?.[0];
        if (
          field !== undefined &&
          (head === undefined ||
            head === "name" ||
            !(type && Object.hasOwn(type.schema.shape, head)))
        )
          throw new Error(
            `The rule ${id} gave the field ${field} for ${node.path}, which is not a JSON Pointer to a field its type ${String(type?.name)} gives a node.`,
          );
        problems.push({
          path: pathOf(node, head),
          rule: id,
          ...(field !== undefined && { field }),
          message,
        });
      }
    }
  }
  return problems;
}

/** The nodes, each by its name: a name two nodes share has both. */
function byNameOf(nodes: readonly Node[]) {
  const byName = new Map<string, Node[]>();
  for (const node of nodes)
    byName.set(node.name, [...(byName.get(node.name) ?? []), node]);
  return byName;
}

/** A thing a source found and could not read. One that is a note, as the loader's are, says so. */
export type Unread = Loaded["unread"][number] & { note?: true };

/**
 * What is wrong with the pieces, by the schema, in path order, from every source as one graph: the pieces of one name
 * are merged into one node first. `unread` holds the things a source found and could not read: a link to one is not a
 * problem. A note that could not be read and a node with a note of its name are two notes of one name, a duplicate;
 * any other thing that could not be read may be a piece of the node of its name, so it is not.
 */
export function lint(
  schema: Schema,
  pieces: readonly Piece[],
  unread: readonly Unread[] = [],
): Problem[] {
  const unreadNotes = new Map<string, string[]>();
  for (const { path, name, note } of unread)
    if (note) unreadNotes.set(name, [...(unreadNotes.get(name) ?? []), path]);
  const unreadNames = new Set(unread.map(({ name }) => name));
  // The schema's own check once: a node of an imported type is parsed by its own schema, not by this one.
  checked(schema);
  // A schema made another way than defineSchema, such as a spread, has its rules checked here.
  checkRules(schema);
  const seen: Seen = seenTypes<Schema>(schema);
  const { nodes, problems } = mergeAll(pieces);
  const byName = byNameOf(nodes);

  for (const [name, same] of byName) {
    for (const node of same) {
      const others = [
        ...same.filter((n) => n !== node).map((n) => n.path),
        ...(node.pieces.some(isNote) ? (unreadNotes.get(name) ?? []) : []),
      ];
      if (others.length === 0) continue;
      problems.push({
        path: node.path,
        rule: "basis/unique-name",
        message: `The name ${node.name} is also the name of ${others.join(", ")}.`,
      });
    }
  }
  // The parsed nodes, kept only for the rules to read.
  const parsed =
    rulesSeen(schema).length > 0 ? new Map<Node, unknown>() : undefined;
  for (const node of nodes)
    problems.push(
      ...nodeProblems(schema, seen, node, byName, unreadNames, parsed),
    );
  problems.push(...keyProblems(seen, nodes));
  if (parsed)
    problems.push(...ruleProblems(schema, seen, parsed, byName, unreadNames));
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
      return { pieces: [], problems: [], unread: [] };
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

const isTypeNote = (piece: Piece) => piece.fields.type === "type";

/** What is wrong with the type note of one type, if it has one. */
function typeNoteProblems(
  owner: Schema,
  type: Type,
  typeNote: Piece | undefined,
): { rule: CoreRule; field?: string; message: string }[] {
  const of = `the type ${type.name} of ${owner.name}`;
  if (!typeNote)
    return [
      {
        rule: "basis/type-note",
        message: `The type ${type.name} of ${owner.name} has no type note: make this note, of type type, with the description of ${type.name}.`,
      },
    ];
  const problems: { rule: CoreRule; field?: string; message: string }[] = [];
  if (typeNote.fields.description !== type.description)
    problems.push({
      rule: "basis/type-note-agrees",
      field: "/description",
      message: `Not the description of ${of}: make it ${JSON.stringify(type.description)}`,
    });
  // The flag of the type, kept in the note as true, or absent.
  const on = typeNote.fields.abstract === true;
  if (on && !type.abstract)
    problems.push({
      rule: "basis/type-note-agrees",
      field: "/abstract",
      message: `True, and ${of} is not abstract: remove it.`,
    });
  if (!on && type.abstract)
    problems.push({
      rule: "basis/type-note-agrees",
      field: "/abstract",
      message: `Missing: ${of} is abstract, so add abstract: true.`,
    });
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
  linted: { pieces: Piece[]; problems: Problem[] },
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
    [...linted.pieces, ...linted.problems].map((p) => join(realRoot, p.path)),
  );
  const seen: Seen = seenTypes<Schema>(schema);
  const problems: Problem[] = [];
  const folders: string[] = [];
  const outside: Piece[] = [];
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
    const unread = new Set(read.unread.map(({ name }) => name));
    const typeNotes = new Map(
      read.pieces
        .filter(isTypeNote)
        .map((piece) => [
          piece.name,
          { ...piece, path: from(join(typesFolder, piece.path)) },
        ]),
    );
    outside.push(
      ...read.pieces.filter(notLoaded).map((piece) => ({
        ...piece,
        path: from(join(typesFolder, piece.path)),
      })),
    );
    const own = ownTypesOf(owner.types);
    for (const type of own) {
      if (unread.has(type.name)) continue;
      const path = from(join(typesFolder, `${type.name}.md`));
      for (const problem of typeNoteProblems(
        owner,
        type,
        typeNotes.get(type.name),
      ))
        problems.push({ path, ...problem });
    }
    for (const typeNote of typeNotes.values())
      if (!own.some((type) => type.name === typeNote.name))
        problems.push({
          path: typeNote.path,
          rule: "basis/type-note-type",
          message: `The schema ${owner.name} has no type ${typeNote.name}: remove this type note, or give it the name of a type of ${owner.name}.`,
        });
  }
  // A type note outside the folder linted is a node of its own: it merges with no piece.
  const outsideNodes = outside.map((piece) => mergeOne([piece]).node);
  const byName = byNameOf([...mergeAll(linted.pieces).nodes, ...outsideNodes]);
  for (const node of outsideNodes)
    problems.push(...nodeProblems(schema, seen, node, byName, new Set()));
  for (const piece of linted.pieces.filter(isTypeNote))
    if (!folders.includes(dirname(join(realRoot, piece.path))))
      problems.push({
        path: piece.path,
        rule: "basis/type-note-folder",
        message: `A type note outside the folder of the type notes of each schema the lint sees: move it to the folder of its schema, one of ${folders.map(from).join(", ")}.`,
      });
  return problems;
}

/**
 * A source of pieces beside the notes of a folder: a function that gives what it read, as the loader gives a folder.
 * It gives pieces, not notes: every note is the loader's, read from the folder that holds it. Each path is from the
 * folder linted, and a link is the name of the node it points at. The package that knows a thing's shape writes its
 * source: basis reads no code.
 */
export type Source = () => Loaded<SourcePiece> | Promise<Loaded<SourcePiece>>;

/** A piece a source gives: never a body, as a note has. */
type SourcePiece = Omit<Piece, "body" | "source"> & {
  body?: never;
  source?: never;
};

/** What a folder's lint takes beside the folder: the paths that are not notes, and the sources of more pieces. */
export type LintOptions = FolderOptions & { sources?: readonly Source[] };

/** A path from the folder linted, as SARIF's relative uri: not absolute, with `/` between parts, and no `.` or `..` part. */
const relativePath = z
  .string()
  .refine(
    (path) =>
      !path.includes("\\") &&
      path
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Not a path from the folder linted, with / between parts.",
  );

/**
 * What a source gives, checked: a source that gives another shape is at fault, not a piece. What it could not read is
 * fatal, of no rule, as the loader's: a check of what it read is a rule.
 */
const LoadedShape = z.strictObject({
  pieces: z.array(
    z.strictObject({
      path: relativePath,
      name: z.string(),
      fields: z.record(z.string(), z.unknown()),
    }),
  ),
  problems: z.array(
    z.strictObject({
      path: relativePath,
      message: z.string().min(1),
      fatal: z.literal(true),
    }),
  ),
  unread: z.array(z.strictObject({ path: relativePath, name: z.string() })),
});

/**
 * What a source gives, or a throw that names the source: its function's name, or its place in the list. A source is
 * also at fault when it gives the path of a note the folder holds, or a piece of type type: a type note is a note, in
 * the folder its schema declares.
 */
async function read(
  source: Source,
  at: number,
  notePaths: ReadonlySet<string>,
): Promise<Loaded> {
  const id = source.name || `number ${at + 1}`;
  let loaded: unknown;
  try {
    loaded = await source();
  } catch (error) {
    throw new Error(
      `The source ${id} threw: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const parsed = LoadedShape.safeParse(loaded);
  if (!parsed.success)
    throw new Error(
      `The source ${id} gave something other than { pieces, problems, unread }: ${z.prettifyError(parsed.error)}`,
    );
  const { pieces, problems, unread } = parsed.data;
  const taken = [...pieces, ...problems, ...unread].find(({ path }) =>
    notePaths.has(path),
  );
  if (taken)
    throw new Error(
      `The source ${id} gave the path ${taken.path}, which is the path of a note of the folder.`,
    );
  const typePiece = pieces.find(({ fields }) => fields.type === "type");
  if (typePiece)
    throw new Error(
      `The source ${id} gave ${typePiece.name}, of type type: a type note is a note, in the folder its schema declares.`,
    );
  // Its own pieces, not the parse's copies: the lint changes nothing it is given.
  return loaded as Loaded;
}

/**
 * A folder, loaded, with the pieces of each source, linted as one graph, and the type notes of each schema the lint
 * sees: the loader's and the sources' problems and the lint's, in path order.
 */
export async function lintFolder(
  schema: Schema,
  folder: string,
  { sources = [], ...options }: LintOptions = {},
): Promise<Problem[]> {
  const notes = await loadFolder(folder, options);
  const notePaths = new Set(
    [...notes.pieces, ...notes.problems, ...notes.unread].map((p) => p.path),
  );
  const loaded: Loaded[] = [
    notes,
    ...(await Promise.all(
      sources.map((source, at) => read(source, at, notePaths)),
    )),
  ];
  // Each piece with the source that gave it, by its place in the list: two sources can share a function's name.
  const pieces = loaded
    .flatMap((l, at) =>
      at === 0
        ? l.pieces
        : l.pieces.map((piece) => ({ ...piece, source: `${at}` })),
    )
    .sort(byPath);
  const problems = loaded.flatMap((l) => l.problems);
  // The loader's are notes.
  const unread: Unread[] = [
    ...notes.unread.map((u) => ({ ...u, note: true as const })),
    ...loaded.slice(1).flatMap((l) => l.unread),
  ];
  return [
    ...problems,
    ...lint(schema, pieces, unread),
    ...(await typeNotesOf(schema, folder, { pieces, problems })),
  ].sort(byPath);
}
