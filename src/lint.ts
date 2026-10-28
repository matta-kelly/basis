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
  type Note,
  type Piece,
  type Problem,
  type Source,
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
  partsOf,
  rulesSeen,
  schemasSeen,
  seesType,
  seenTypes,
  noteSchemaOf,
  Wikilink,
  type Graph,
  type Link,
  type LinkFailure,
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
    id: "basis/type-note-type",
    description:
      "Each type note in a schema's folder explains a type of that schema.",
  },
  {
    id: "basis/type-note-folder",
    description:
      "Each type note sits in the folder of type notes of a schema the lint sees.",
  },
  {
    id: "basis/one-definition",
    description:
      "Each zod object a schema's exports give is part of a type the schema sees, or a bridge it names.",
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
      inspect(thing.fields, {
        depth: Infinity,
        sorted: true,
        maxArrayLength: Infinity,
        maxStringLength: Infinity,
      }),
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
  if (home.fields.type !== undefined) {
    fields.type = home.fields.type;
    from.set("type", home);
  }
  for (const piece of sorted)
    for (const [field, value] of Object.entries(piece.fields)) {
      // A field set to undefined is not given.
      if (field === "type" || value === undefined) continue;
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
            .map((other) =>
              other.path === piece.path
                ? `${other.path} (source ${other.source ?? "notes"})`
                : other.path,
            )
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

/** Each node's parse, once, by the type the schema sees: the lint's problems and the graph read the same one. */
const parses = new WeakMap<Node, z.ZodSafeParseResult<unknown>>();

/** A node parsed by its type, as its pieces write it, with its name. */
function parseOf(type: Type, node: Node): z.ZodSafeParseResult<unknown> {
  let result = parses.get(node);
  if (!result) {
    result = schemaOf(type, node).safeParse({
      ...node.fields,
      name: node.name,
    });
    parses.set(node, result);
  }
  return result;
}

/**
 * A link's own message for a failure, or none for basis's. A message that throws, or gives other than a non-empty
 * string or undefined, is a fault of the link, not of the node: the lint throws, naming both.
 */
function linkMessage(
  type: Type,
  link: Link,
  node: Node,
  failure: LinkFailure,
  graph: Graph,
): string | undefined {
  if (!link.message) return undefined;
  const of = `The message of the link ${link.name} of ${type.name}`;
  let message: unknown;
  try {
    message = link.message(failure, graph);
  } catch (error) {
    throw new Error(
      `${of} threw on ${node.path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (message !== undefined && (typeof message !== "string" || message === ""))
    throw new Error(
      `${of} gave something other than a message or undefined for ${node.path}.`,
    );
  return message;
}

/**
 * A parse's issues as problems, one for each field, each on the piece that gives the field. A bad name is a problem of
 * the name. A required link that gives no name, absent or an empty list, has the link's own message, if it gives one.
 */
function fieldProblems(
  type: Type,
  node: Node,
  error: z.ZodError,
  graph: Graph,
): Problem[] {
  const links = new Map(linksOf(type).map((link) => [link.name, link]));
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
    const link =
      issue.path.length === 1 ? links.get(String(issue.path[0])) : undefined;
    const value = link && node.fields[link.name];
    const noName =
      link !== undefined &&
      !link.optional &&
      (value === undefined || (Array.isArray(value) && value.length === 0));
    const own = noName
      ? linkMessage(
          type,
          link,
          node,
          { kind: "missing", node: node.name },
          graph,
        )
      : undefined;
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
        message:
          own ??
          (missing ? `Missing: its type needs ${needed} here.` : issue.message),
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
  graph: Graph,
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

  // By the type the schema sees, as its pieces write it: a node of an imported type is of that type.
  const parse = parseOf(at.type, node);
  if (!parse.success)
    problems.push(...fieldProblems(at.type, node, parse.error, graph));

  for (const link of linksOf(at.type)) {
    const to = link.to().map((type) => type.name);
    const own = (failure: LinkFailure) =>
      linkMessage(at.type, link, node, failure, graph);
    for (const name of linkNames(node, link.name)) {
      const targets = byName.get(name);
      if (!targets) {
        // A piece that could not be read exists, and has that problem itself.
        if (unread.has(name)) continue;
        problems.push(
          problem(
            "basis/link",
            link.name,
            own({ kind: "not-a-node", node: node.name, target: name }) ??
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
        const targetType = String(targets[0]?.fields.type);
        problems.push(
          problem(
            "basis/link",
            link.name,
            own({
              kind: "wrong-type",
              node: node.name,
              target: name,
              targetType,
            }) ??
              `It points at ${name}, which is a ${targetType}, not a ${to.join(" or a ")}.`,
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

/** Plain data: an array, or an object of no class. Anything else, a function, a zod schema or a Date, is a live value. */
const isPlain = (value: unknown): value is object =>
  typeof value === "object" &&
  value !== null &&
  [Array.prototype, Object.prototype, null].includes(
    Object.getPrototypeOf(value),
  );

/**
 * A frozen copy of the plain data in a value, so a rule cannot change what the next one reads, and the caller's fields
 * stay theirs. A live value is kept as its piece gives it: its type describes it. A value that holds itself, as a YAML
 * alias can make, holds its copy.
 */
function frozenCopy<V>(value: V, copies = new Map<object, object>()): V {
  if (!isPlain(value)) return value;
  const had = copies.get(value);
  if (had) return had as V;
  const copy: Record<PropertyKey, unknown> = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value) as object | null);
  copies.set(value, copy);
  // Defined, not assigned: a key named __proto__ stays an own key, as in the value, and sets no prototype.
  for (const [key, item] of Object.entries(value))
    Object.defineProperty(copy, key, {
      value: frozenCopy(item, copies),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return Object.freeze(copy) as V;
}

/** The graph a rule and a link's message read, and each node of a type that parsed, with its value, in path order. */
type Parsed = {
  graph: Graph;
  nodesOf: (type: Type) => [Node, unknown][];
};

/**
 * The graph of the nodes linted: each node that parsed, by its name or by its type. Each node is parsed when the graph
 * is first read, so it is whole wherever it is read from. A name two nodes share, or an unread note shares, gives none.
 */
function parsedOf(
  schema: Schema,
  seen: Seen,
  nodes: readonly Node[],
  byName: Map<string, Node[]>,
  contested: Set<string>,
): Parsed {
  const isOf = (node: Node, type: Type) => {
    const at = nodeType(seen, node);
    return at !== undefined && isOfType(at.type, type);
  };
  let values: Map<Node, unknown> | undefined;
  const valuesOf = () => {
    values ??= new Map(
      [...nodes].sort(byPath).flatMap((node): [Node, unknown][] => {
        const at = nodeType(seen, node);
        if (!at || at.type.abstract) return [];
        const parse = parseOf(at.type, node);
        return parse.success ? [[node, frozenCopy(parse.data)]] : [];
      }),
    );
    return values;
  };
  const ofType = new Map<Type, [Node, unknown][]>();
  const nodesOf = (type: Type) => {
    if (!ofType.has(type))
      ofType.set(
        type,
        [...valuesOf()].filter(([node]) => isOf(node, type)),
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
        same?.length === 1 && !contested.has(name) ? same[0] : undefined;
      return only && valuesOf().has(only) && isOf(only, type)
        ? (valuesOf().get(only) as never)
        : undefined;
    },
    all: (type) => nodesOf(seenType(type)).map(([, value]) => value as never),
  };
  return { graph, nodesOf };
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
  { graph, nodesOf }: Parsed,
): Problem[] {
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
 * What a lint gives: what is wrong, in path order, and the graph it checked, which a rule reads: each node that parsed,
 * by its name or by its type, with each value as its piece gives it. A program runs on the graph once the problems
 * are none.
 */
export type LintResult = { problems: Problem[]; graph: Graph };

/**
 * What is wrong with the pieces, by the schema, in path order, from every source as one graph, and the graph: the
 * pieces of one name are merged into one node first. `unread` holds the things a source found and could not read: a
 * link to one is not a problem. A note that could not be read and a node with a note of its name are two notes of one
 * name, a duplicate; any other thing that could not be read may be a piece of the node of its name, so it is not.
 */
export function lint(
  schema: Schema,
  pieces: readonly Piece[],
  unread: readonly Unread[] = [],
): LintResult {
  const unreadNotes = new Map<string, string[]>();
  for (const { path, name, note } of unread)
    if (note) unreadNotes.set(name, [...(unreadNotes.get(name) ?? []), path]);
  const unreadNames = new Set(unread.map(({ name }) => name));
  // The schema's own check once: a node of an imported type is parsed by its own schema, not by this one.
  checked(schema);
  // A schema made another way than defineSchema, such as a spread, has its rules checked here.
  checkRules(schema);
  const seen: Seen = seenTypes<Schema>(schema);
  // A type's code piece joins its one type note. Two type notes of one name are two nodes that share it, and neither
  // is the type's.
  const typeNotes = new Map<string, number>();
  for (const piece of pieces)
    if (isNote(piece) && isTypeNote(piece))
      typeNotes.set(piece.name, (typeNotes.get(piece.name) ?? 0) + 1);
  const { nodes, problems } = mergeAll([
    ...pieces,
    ...pieces.flatMap((piece) =>
      typeNotes.get(piece.name) === 1 ? (codePieceOf(seen, piece) ?? []) : [],
    ),
  ]);
  const byName = byNameOf(nodes);

  // The names an unread note shares with a node that has a note: two notes of one name, so neither is the node.
  const contested = new Set<string>();
  for (const [name, same] of byName) {
    for (const node of same) {
      const unreadNote = node.pieces.some(isNote)
        ? (unreadNotes.get(name) ?? [])
        : [];
      if (unreadNote.length) contested.add(name);
      const others = [
        ...same.filter((n) => n !== node).map((n) => n.path),
        ...unreadNote,
      ];
      if (others.length === 0) continue;
      problems.push({
        path: node.path,
        rule: "basis/unique-name",
        message: `The name ${node.name} is also the name of ${others.join(", ")}.`,
      });
    }
  }
  const parsed = parsedOf(schema, seen, nodes, byName, contested);
  for (const node of nodes)
    problems.push(
      ...nodeProblems(schema, seen, node, byName, unreadNames, parsed.graph),
    );
  problems.push(...keyProblems(seen, nodes));
  problems.push(...ruleProblems(schema, seen, parsed));
  return { problems: problems.sort(byPath), graph: parsed.graph };
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

/** The folder linted, as its real path, and a path from it: as the loader gives it inside, and as given outside. */
async function placeOf(folder: string) {
  const root = resolve(folder);
  const realRoot = await realPathOf(root);
  const from = (path: string) => {
    const inside = relative(realRoot, path);
    const at =
      inside.startsWith("..") || isAbsolute(inside)
        ? relative(root, path)
        : inside;
    return at.split(sep).join("/") || ".";
  };
  return { realRoot, from };
}

/**
 * The code piece of the type a type note explains, when the schema sees a type of its name: its description and
 * abstract, as defineType made it, of the source defineType, at the note's path. The note gives the prose, and the two
 * are pieces of one node.
 */
function codePieceOf(seen: Seen, piece: Piece): Piece | undefined {
  const at =
    isNote(piece) && isTypeNote(piece) ? seen.get(piece.name) : undefined;
  return (
    at && {
      path: piece.path,
      name: piece.name,
      source: "defineType",
      fields: {
        type: "type",
        description: at.type.description,
        abstract: at.type.abstract === true,
      },
    }
  );
}

/** A note, by its path from the folder linted, with its real path. */
type Placed = { piece: Piece; at: string };

/**
 * What is wrong with the type notes of each schema the lint sees, in the folder each one declares: each type the schema
 * owns has its note there, and each type note there explains one of them. Each type note is in the folder of a schema
 * the lint sees. Folders are compared by their real paths.
 */
async function typeNoteProblems(
  schema: Schema,
  notes: readonly Placed[],
  unread: readonly { name: string; at: string }[],
  from: (path: string) => string,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  const folders: string[] = [];
  const typeNotes = notes.filter(({ piece }) => isTypeNote(piece));
  for (const owner of schemasSeen(schema)) {
    if (!owner.typeNotes) continue;
    const typesFolder = await realPathOf(
      resolve(fileURLToPath(owner.typeNotes)),
    );
    folders.push(typesFolder);
    const here = new Map(
      typeNotes
        .filter(({ at }) => dirname(at) === typesFolder)
        .map(({ piece }) => [piece.name, piece]),
    );
    const notRead = new Set(
      unread
        .filter(({ at }) => dirname(at) === typesFolder)
        .map(({ name }) => name),
    );
    const own = ownTypesOf(owner.types);
    for (const type of own)
      if (!notRead.has(type.name) && !here.has(type.name))
        problems.push({
          path: from(join(typesFolder, `${type.name}.md`)),
          rule: "basis/type-note",
          message: `The type ${type.name} of ${owner.name} has no type note: make this note, of type type, and say in its body what ${type.name} is for.`,
        });
    for (const typeNote of here.values())
      if (!own.some((type) => type.name === typeNote.name))
        problems.push({
          path: typeNote.path,
          rule: "basis/type-note-type",
          message: `The schema ${owner.name} has no type ${typeNote.name}: remove this type note, or give it the name of a type of ${owner.name}.`,
        });
  }
  for (const { piece, at } of typeNotes)
    if (!folders.includes(dirname(at)))
      problems.push({
        path: piece.path,
        rule: "basis/type-note-folder",
        message: `A type note outside the folder of the type notes of each schema the lint sees: move it to the folder of its schema, one of ${folders.map(from).join(", ")}.`,
      });
  return problems;
}

/**
 * A folder the lint reads, by its real path: the paths in it that are not notes, and the sources of pieces beside its
 * notes. A folder of type notes that is no other place's folder is read alone, by its own notes only, whatever the
 * place it is in leaves out, and may not be there.
 */
type Place = {
  folder: string;
  skip?: (path: string) => boolean;
  sources: readonly Source[];
  typeNotes?: true;
};

/** Whether a path is a folder, or in it. */
const within = (folder: string, path: string) =>
  path === folder || path.startsWith(folder + sep);

/** A folder of a schema, from its file URL, as its real path. */
const folderOf = (url: URL) => realPathOf(resolve(fileURLToPath(url)));

/**
 * The places of a schema's lint: the folder linted, for the schema linted; the folder of notes of each schema it sees,
 * with its skip and sources; and each folder of type notes that is no other place's folder. The folder linted, when a
 * schema it sees names it as its notes, is that schema's place, with its skip and sources; a skip or sources given
 * beside it are a second place for one fact, and refused.
 */
async function placesOf(
  schema: Schema,
  root: string,
  { skip, sources }: LintOptions,
): Promise<Place[]> {
  const places: Place[] = [
    { folder: root, ...(skip && { skip }), sources: sources ?? [] },
  ];
  const seen = schemasSeen(schema);
  for (const owner of seen) {
    if (!owner.notes) continue;
    const folder = await folderOf(owner.notes);
    const place: Place = {
      folder,
      ...(owner.skip && { skip: owner.skip }),
      sources: owner.sources ?? [],
    };
    if (folder !== root) {
      places.push(place);
      continue;
    }
    if (skip !== undefined || sources !== undefined)
      throw new Error(
        `The schema ${owner.name} names this folder as its notes: give its skip and sources in its defineSchema.`,
      );
    places[0] = place;
  }
  for (const owner of seen) {
    if (!owner.typeNotes) continue;
    const folder = await folderOf(owner.typeNotes);
    if (!places.some((place) => place.folder === folder))
      places.push({
        folder,
        skip: (path) => path.includes("/"),
        sources: [],
        typeNotes: true,
      });
  }
  return places;
}

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
 * also at fault when it gives the path of a note the lint reads, in any place, or a piece of type type: a type note is a note, in
 * the folder its schema declares.
 */
async function readSource(
  source: Source,
  at: number,
  isNotePath: (path: string) => boolean,
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
    isNotePath(path),
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
 * What is wrong with the exports of each schema the lint sees that gives them: each zod object exported is part of a
 * type the schema sees, at any depth of its zod schema or of the type it extends, or a bridge the schema names; and
 * each bridge is an export, a zod object, and no part of a type. A problem is on the folder of the schema's notes, or
 * of its type notes, or the folder linted. Exports that throw, or that are no object, are
 * a fault of the schema: the lint throws, naming it.
 */
async function oneDefinitionProblems(
  schema: Schema,
  from: (path: string) => string,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  for (const owner of schemasSeen(schema)) {
    if (!owner.exports) continue;
    let exported: unknown;
    try {
      exported = await owner.exports();
    } catch (error) {
      throw new Error(
        `The exports of ${owner.name} threw: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (typeof exported !== "object" || exported === null)
      throw new Error(
        `The exports of ${owner.name} gave something other than an object of its exports.`,
      );
    const defined = new Set<object>();
    for (const { type } of seenTypes<Schema>(owner).values())
      for (let at: Type | undefined = type; at; at = at.extends)
        for (const part of partsOf(at.schema)) defined.add(part);
    const bridges = owner.bridges ?? [];
    const home = owner.notes ?? owner.typeNotes;
    const path = home ? from(await folderOf(home)) : ".";
    const problem = (message: string) =>
      problems.push({ path, rule: "basis/one-definition", message });
    // Any zod object, of zod or of zod/mini: both are of zod's core class.
    const isShape = (value: unknown) => value instanceof z.core.$ZodObject;
    for (const [name, value] of Object.entries(exported))
      if (isShape(value) && !defined.has(value) && !bridges.includes(name))
        problem(
          `The export ${name} of ${owner.name} is a zod object that is no part of a type the schema sees: define it once, with defineType, and export the type. If it meets an outside standard, name it in the schema's bridges.`,
        );
    // A bridge that is no longer one is stale: a name that would excuse a shape it does not name.
    for (const name of bridges) {
      const value: unknown = Object.hasOwn(exported, name)
        ? (exported as Record<string, unknown>)[name]
        : undefined;
      const stale = !Object.hasOwn(exported, name)
        ? "is no export of it"
        : !isShape(value)
          ? "is no zod object"
          : defined.has(value as object)
            ? "is part of a type the schema sees"
            : undefined;
      if (stale)
        problem(
          `The bridge ${name} of ${owner.name} ${stale}: remove it from bridges.`,
        );
    }
  }
  return problems;
}

/**
 * A folder, and each place of the schema's lint, loaded, with the pieces of each source and the code piece of each type,
 * linted as one graph: the schema, and each schema it imports. A folder another place holds is that place's, read once,
 * so an imported schema's folder inside the folder linted is read as that schema's. Gives the loader's and the sources'
 * problems and the lint's, in path order, each by its path from the folder linted, and the graph of every piece.
 */
export async function lintFolder(
  schema: Schema,
  folder: string,
  options: LintOptions = {},
): Promise<LintResult> {
  const { realRoot, from } = await placeOf(folder);
  const places = await placesOf(schema, realRoot, options);
  const pieces: Piece[] = [];
  const problems: Problem[] = [];
  const unread: (Unread & { at: string })[] = [];
  const notes: Placed[] = [];
  // Each path a place's loader read, or could not read, by its real path: no source gives a note's path.
  const notePaths = new Set<string>();
  const at = (place: Place, path: string) => join(place.folder, path);
  const placed =
    (place: Place) =>
    <P extends { path: string }>(p: P): P => ({
      ...p,
      path: from(at(place, p.path)),
    });
  for (const place of places) {
    const inner = places.filter(
      (other) =>
        other.folder !== place.folder && within(place.folder, other.folder),
    );
    // A folder another place reads is that place's: all in it, or, for a folder of type notes, its own notes.
    const skip = (path: string) =>
      (place.skip?.(path) ?? false) ||
      inner.some((other) =>
        other.typeNotes
          ? dirname(at(place, path)) === other.folder && path.endsWith(".md")
          : within(other.folder, at(place, path)),
      );
    let read: Loaded<Note>;
    try {
      read = await loadFolder(place.folder, { skip });
    } catch (error) {
      if (
        !place.typeNotes ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
      read = { pieces: [], problems: [], unread: [] };
    }
    for (const note of read.pieces) {
      const piece = placed(place)(note);
      pieces.push(piece);
      notes.push({ piece, at: at(place, note.path) });
    }
    problems.push(...read.problems.map(placed(place)));
    unread.push(
      ...read.unread.map((u) => ({
        ...placed(place)(u),
        note: true as const,
        at: at(place, u.path),
      })),
    );
    for (const p of [...read.pieces, ...read.problems, ...read.unread])
      notePaths.add(at(place, p.path));
  }
  let sourcesRead = 0;
  for (const place of places) {
    const first = sourcesRead;
    sourcesRead += place.sources.length;
    const loaded = await Promise.all(
      place.sources.map((source, i) =>
        readSource(source, first + i, (path) => notePaths.has(at(place, path))),
      ),
    );
    // Each piece with the source that gave it, by its place in the lint: two sources can share a function's name.
    loaded.forEach((l, i) => {
      pieces.push(
        ...l.pieces.map((piece) => ({
          ...placed(place)(piece),
          source: `${first + i + 1}`,
        })),
      );
      problems.push(...l.problems.map(placed(place)));
      unread.push(
        ...l.unread.map((u) => ({
          ...placed(place)(u),
          at: at(place, u.path),
        })),
      );
    });
  }
  const result = lint(schema, pieces.sort(byPath), unread);
  return {
    problems: [
      ...problems,
      ...result.problems,
      ...(await typeNoteProblems(schema, notes, unread, from)),
      ...(await oneDefinitionProblems(schema, from)),
    ].sort(byPath),
    graph: result.graph,
  };
}
