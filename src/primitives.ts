/**
 * The primitives as code: a type, a link, and a schema that holds them.
 * A node is one thing of a type, from a source: a note, whose frontmatter holds its fields and whose file name is its
 * name, or a node a source gives.
 * The world is closed: a node carries the fields of its type, its properties and the links
 * that start from it, and nothing else.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";

// A name's schema, new each time: each link is made of schemas of its own.
const nameOf = () =>
  z.string().regex(/^[a-z][a-z0-9-]*$/, "Not a lowercase slug.");

/** A node is named by a short slug, so one node can point at another by name. */
export const Name = nameOf();

/**
 * What every node has, as PG-Schema has it: its identity, its label and a property. The name is its identity, from its
 * file name, and no two nodes share one. The type is its label: every type fixes it to its own name. The description
 * says what the node is.
 */
const nodeShape = {
  name: Name,
  type: Name,
  description: z.string().min(1),
};

const isNodeField = (field: string) => Object.hasOwn(nodeShape, field);

/** A name the object prototype has (`constructor`, `toString`). A parse reads `node[name]`, and would find the prototype's value. */
const isPrototypeName = (field: string) =>
  Object.hasOwn(Object.prototype, field);

/** A link as a note writes it: "[[name]]". Parsed to the name, the link's value in the graph. */
const wikilinkOf = () =>
  z
    .string()
    .regex(/^\[\[[a-z][a-z0-9-]*\]\]$/, 'Not a wikilink, "[[name]]".')
    .transform((link) => link.slice(2, -2));

/**
 * A schema, the schemas and checks inside it, and their defs: found by walking each def's values, its arrays and plain
 * objects, and the schema a lazy schema returns. A method chained on a schema wraps it, or makes a clone that keeps its def
 * or the schemas inside it.
 */
function partsOf(schema: z.ZodType): object[] {
  const found = new Set<object>();
  // A lazy is opened one level: a schema that makes itself again through a function would not end.
  const walk = (value: unknown, inLazy = false) => {
    if (typeof value !== "object" || value === null || found.has(value)) return;
    if (value instanceof z.ZodType) {
      found.add(value);
      walk(value._zod.def, inLazy);
      if (value instanceof z.ZodLazy && !inLazy) walk(value.unwrap(), true);
    } else if (value instanceof z.core.$ZodCheck) {
      // A check, such as a name's pattern: a method chained on a schema keeps its checks in the clone it makes.
      found.add(value);
      walk(value._zod.def, inLazy);
    } else if (
      Array.isArray(value) ||
      [Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      found.add(value);
      for (const item of Object.values(value)) walk(item, inLazy);
    }
  };
  walk(schema);
  return [...found];
}

/** A kind of node: the one closed schema of its nodes, with the fields every node has, its parents' and its own. */
export type Type = {
  name: string;
  description: string;
  schema: z.ZodObject;
  /** No node is of it (PG-Schema's ABSTRACT, GraphQL's interface): its nodes are of the types that inherit it. */
  abstract?: boolean;
  /** The types it inherits (PG-Schema's &): their fields and keys are its own. Every type inherits node, unlisted. */
  parents?: readonly Type[];
  /** The type it extends (GraphQL's extend type): the same type, under its name, with more fields. */
  extends?: Type;
  /** Its identity rule: fields of its schema that, together, no two of its nodes share. None when empty. */
  key?: readonly string[];
};

/**
 * The parent of every type: what every node has. It is abstract, so no node is of node alone. It is the root of the
 * graph of types, not a type of a schema, and a link cannot point at it.
 */
export const node = Object.freeze({
  name: "node",
  description: "What every node has: its name, its type and its description.",
  abstract: true,
  parents: Object.freeze([]),
  schema: z.strictObject(nodeShape),
  key: Object.freeze([]),
} as const);

/** One type made from a union of them: the fields every parent gives, as one shape. */
type Intersection<U> = (U extends unknown ? (u: U) => void : never) extends (
  i: infer I,
) => void
  ? I
  : never;

/** The fields a type gets from its parents, beside the fields every node has. */
type Inherited<P extends readonly Type[]> = P extends readonly []
  ? Record<never, never>
  : Omit<Intersection<P[number]["schema"]["shape"]>, keyof typeof nodeShape>;

/** The fields each parent gives, beside the fields every node has: the first parent's schema for a field, in order. */
function inheritedOf(parents: readonly Type[]): z.ZodRawShape {
  const inherited: Record<string, z.core.$ZodType> = {};
  for (const parent of parents)
    for (const [field, schema] of Object.entries(parent.schema.shape))
      if (!isNodeField(field) && !Object.hasOwn(inherited, field))
        inherited[field] = schema;
  return inherited;
}

/**
 * The fields a key can name: fields beside those every node has, each one string, number or boolean.
 * zod marks a field a node can leave out (optional, exactOptional), whatever it gives. A key is checked against the
 * schema, not described again.
 */
type KeyField<F extends z.ZodRawShape> = Exclude<
  {
    [K in keyof F & string]: F[K] extends { _zod: { optout: "optional" } }
      ? never
      : z.output<F[K]> extends string | number | boolean
        ? K
        : never;
  }[keyof F & string],
  keyof typeof nodeShape
>;

/** A copy of a key, frozen. A value that is not a list is kept, and the schema refuses it. */
const keyCopy = <K extends readonly string[]>(key: K | undefined) =>
  Object.freeze(Array.isArray(key) ? [...key] : (key ?? []));

/** The types defineType made. A schema holds no other: a type's zod schema is made from its fields, once. */
const madeTypes = new WeakSet<Type>();

/** The names of the fields each type was given, apart from those it inherits. */
const ownFields = new WeakMap<Type, readonly string[]>();

/**
 * A kind of node, and the fields its nodes carry beside those every node has: its parents' and its own. An abstract
 * type has no nodes; the types that inherit it do. The schema that holds it checks it.
 */
export function defineType<
  const N extends string,
  const F extends z.ZodRawShape,
  const P extends readonly Type[] = readonly [],
  const K extends readonly KeyField<F & Inherited<P>>[] = readonly [],
>(type: {
  name: N;
  description: string;
  abstract?: boolean;
  parents?: P;
  fields: F;
  key?: K;
}) {
  // One copy of the fields, so each getter is read once. zod copies the shape again: the schema is the one description.
  const fields: F = { ...type.fields };
  const parents: P = Object.freeze([...(type.parents ?? [])]) as unknown as P;
  const inherited = inheritedOf(parents) as Inherited<P>;
  const made = Object.freeze({
    name: type.name,
    description: type.description,
    abstract: type.abstract === true,
    parents,
    // The fields every node has first, then the parents', then its own. Spread before the fields, the literal keeps
    // its type. A field a parent has, or named type, is refused by the schema that holds the type.
    schema: z.strictObject({
      ...nodeShape,
      type: z.literal(type.name),
      ...inherited,
      ...fields,
    }),
    key: keyCopy(type.key),
  });
  madeTypes.add(made);
  ownFields.set(made, Object.freeze(Object.keys(fields)));
  return made;
}

/**
 * A type that extends another, as GraphQL's extend type: the same type, under its name and description, with its
 * fields and more, in a schema that imports it. Its zod schema is the extended type's, extended. It is abstract when
 * that type is, and has its parents. The schema that holds it checks it.
 * The extended type's shape and config are inferred from its schema, so the extension's schema is zod's own type for
 * it. It has the extended type's key. When that type has none, it can add one, over its own fields and that type's.
 */
export function extendType<
  B extends Type,
  S extends z.ZodRawShape,
  C extends z.core.$ZodObjectConfig,
  const F extends z.ZodRawShape,
  const K extends readonly (KeyField<S> | KeyField<F>)[] = readonly [],
>(
  extended: B & { schema: z.ZodObject<S, C> },
  type: {
    /** No field of the type it extends: extend, never override. */
    fields: F & { [K in keyof S]?: never };
    /** None when the type it extends has a key: extend, never override. */
    key?: [NonNullable<B["key"]>[number]] extends [never] ? K : never;
  },
) {
  const fields: F = { ...type.fields };
  const original: B = extended;
  const name: B["name"] = original.name;
  const schema: z.ZodObject<S, C> = extended.schema;
  const made = Object.freeze({
    name,
    description: original.description,
    abstract: original.abstract === true,
    parents: original.parents ?? Object.freeze([]),
    extends: original,
    schema: schema.extend(fields),
    key: keyCopy(type.key ?? original.key),
  });
  madeTypes.add(made);
  return made;
}

/** A link: the field it is, what it points at, how many, and whether a node can leave it out. */
export type Link = {
  name: string;
  /** A thunk, so a link can point at a type defined later. A node of any of its types is a target. */
  to: () => readonly Type[];
  cardinality: "one" | "many";
  optional: boolean;
};

/** The target of each link schema, kept beside the schema and not in its type. */
const links = new WeakMap<object, Omit<Link, "name">>();

/** Each part of each link schema. Each link is made of new schemas, so a part is in no other schema but one made from the link. */
const linkParts = new WeakSet<object>();

/** What a link kind takes: one type, or a list of one or more types. */
type Targets = () => Type | readonly [Type, ...Type[]];

function link<S extends z.ZodType>(
  schema: S,
  { to, ...target }: Omit<Link, "name" | "to"> & { to: Targets },
): S {
  links.set(schema, { ...target, to: () => [to()].flat() });
  for (const part of partsOf(schema)) linkParts.add(part);
  return schema;
}

/** The schema of a link of a kind, on a schema of one name: the name in the graph, or the wikilink of a note. */
const linkSchema = (
  { cardinality, optional }: Pick<Link, "cardinality" | "optional">,
  nameSchema: () => z.ZodType,
) => {
  const one = cardinality === "one" ? nameSchema() : z.array(nameSchema());
  const some = !optional && one instanceof z.ZodArray ? one.min(1) : one;
  return optional ? some.optional() : some;
};

/** A link to one node: its value is the node's name. */
export const one = (to: Targets) =>
  link(nameOf(), { to, cardinality: "one", optional: false });

/** A link to one node or none: the key holds a name, or is absent. */
export const oneOrNone = (to: Targets) =>
  link(nameOf().optional(), { to, cardinality: "one", optional: true });

/** A link to one or more nodes. */
export const many = (to: Targets) =>
  link(z.array(nameOf()).min(1), {
    to,
    cardinality: "many",
    optional: false,
  });

/** A link to any number of nodes: an absent key and an empty list both mean none. */
export const manyOrNone = (to: Targets) =>
  link(z.array(nameOf()).optional(), {
    to,
    cardinality: "many",
    optional: true,
  });

/** For each type, its schema as a note writes it. */
const noteSchemas = new WeakMap<Type, z.ZodObject>();

/**
 * A type's schema as a note writes it: each link a wikilink, "[[name]]", parsed to the name. The same type, in the
 * syntax of markdown: a note's link that is not a wikilink is wrong, as a note writes it.
 */
export function noteSchemaOf(type: Type): z.ZodObject {
  let schema = noteSchemas.get(type);
  if (!schema) {
    schema = type.schema.extend(
      Object.fromEntries(
        linksOf(type).map((l) => [l.name, linkSchema(l, wikilinkOf)]),
      ),
    );
    noteSchemas.set(type, schema);
  }
  return schema;
}

/** The links that start from a type: each of its fields made by one, oneOrNone, many or manyOrNone. */
export const linksOf = (type: Type): Link[] =>
  Object.entries(fieldsOf(type)).flatMap(([name, schema]) => {
    const target = links.get(schema);
    return target ? [{ name, ...target }] : [];
  });

/** A type's fields: its schema's shape, without the fields every node has. Its parents' fields are its own. */
function fieldsOf(type: Type): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(type.schema.shape).filter(([field]) => !isNodeField(field)),
  );
}

/** The fields of node a type's fields replaced: the shape has another schema there than node's, or than its literal. */
function redefinedNode(type: Type): string[] {
  const shape = type.schema.shape;
  const literal = shape.type;
  return [
    ...(shape.name === nodeShape.name ? [] : ["name"]),
    ...(shape.description === nodeShape.description ? [] : ["description"]),
    ...(literal instanceof z.ZodLiteral && literal.value === type.name
      ? []
      : ["type"]),
  ];
}

/** The fields of the extended type whose schema in the extension is not that type's own. */
function overriddenBy(type: Type, extended: Type): string[] {
  const shape = type.schema.shape;
  return Object.entries(extended.schema.shape)
    .filter(([field, schema]) => shape[field] !== schema)
    .map(([field]) => field);
}

/** Whether a field gives one string, number or boolean, read from its schema. A one link gives the name it points at. */
function givesScalar(field: z.core.$ZodType): boolean {
  const link = links.get(field);
  if (link) return link.cardinality === "one" && !link.optional;
  if (
    field instanceof z.ZodString ||
    field instanceof z.ZodNumber ||
    field instanceof z.ZodBoolean ||
    field instanceof z.ZodEnum ||
    field instanceof z.ZodTemplateLiteral
  )
    return true;
  if (field instanceof z.ZodLiteral)
    return [...field.values].every((value) =>
      ["string", "number", "boolean"].includes(typeof value),
    );
  if (
    field instanceof z.ZodDefault ||
    field instanceof z.ZodPrefault ||
    field instanceof z.ZodReadonly ||
    field instanceof z.ZodCatch ||
    field instanceof z.ZodNonOptional
  )
    return givesScalar(field.def.innerType);
  if (field instanceof z.ZodPipe) return givesScalar(field.def.out);
  if (field instanceof z.ZodUnion) return field.options.every(givesScalar);
  return false;
}

/**
 * What is wrong with a type's key: not a list, a field named twice, a field it does not have, one a node can leave
 * out or one that gives other than one string, number or boolean, or a key the type it extends has changed.
 */
function keyProblems(type: Type, fields: z.ZodRawShape): string[] {
  const key = type.key ?? [];
  if (!Array.isArray(key))
    return [`The key of ${type.name} is not a list of field names.`];
  const named = (names: string[], why: string) =>
    names.length > 0
      ? [`The key of ${type.name} names ${names.join(", ")}, ${why}.`]
      : [];
  const schemaOf = (field: string) => {
    const schema = Object.hasOwn(fields, field) ? fields[field] : undefined;
    return schema instanceof z.ZodType ? schema : undefined;
  };
  const absent = (field: string) => schemaOf(field)?._zod.optout === "optional";
  const twice = [...new Set(key.filter((f, i) => key.indexOf(f) !== i))];
  const problems = [
    ...twice.map((field) => `The key of ${type.name} names ${field} twice.`),
    ...named(
      key.filter((field) => !Object.hasOwn(fields, field)),
      `which is not a field of ${type.name}`,
    ),
    ...named(key.filter(absent), "which a node can leave out"),
    ...named(
      key.filter((field) => {
        const schema = schemaOf(field);
        return schema !== undefined && !absent(field) && !givesScalar(schema);
      }),
      "which does not give one string, number or boolean",
    ),
  ];
  const baseKey = type.extends?.key ?? [];
  if (
    baseKey.length > 0 &&
    (key.length !== baseKey.length || key.some((f, i) => f !== baseKey[i]))
  )
    problems.push(
      `The type ${type.name} changes the key of the type it extends: extend, never override.`,
    );
  return problems;
}

/** The type itself, and each type it inherits, at every depth: the names a link to any of them accepts. */
export function lineageOf(type: Type): Set<string> {
  const names = new Set<string>();
  const walk = (at: Type) => {
    if (names.has(at.name)) return;
    names.add(at.name);
    for (const parent of at.parents ?? []) walk(parent);
  };
  walk(type);
  return names;
}

/**
 * The keys a node of a type must keep unique: its own, and each one a type it inherits has, among the nodes of every
 * type that inherits it (PG-Schema's keys). Each key with the name of the type it holds over.
 */
export function keysOf(type: Type): { over: string; key: readonly string[] }[] {
  const keys = new Map<string, readonly string[]>();
  const walk = (at: Type) => {
    if (keys.has(at.name)) return;
    keys.set(at.name, at.key ?? []);
    for (const parent of at.parents ?? []) walk(parent);
  };
  walk(type);
  return [...keys]
    .filter(([, key]) => key.length > 0)
    .map(([over, key]) => ({ over, key }));
}

/** What is wrong with what a type inherits: a parent not made by defineType, two parents that differ on a field, or a field of its own that a parent has. */
function parentProblems(type: Type): string[] {
  const parents = type.parents ?? [];
  if (!Array.isArray(parents))
    return [`The parents of ${type.name} are not a list of types.`];
  const notMade = parents.filter((parent) => !madeTypes.has(parent));
  if (notMade.length > 0)
    return [
      `The type ${type.name} inherits ${notMade.map((p) => String(p?.name)).join(", ")}, which defineType did not make.`,
    ];
  const problems: string[] = [];
  const from = new Map<string, { schema: unknown; parent: string }>();
  for (const parent of parents)
    for (const [field, schema] of Object.entries(parent.schema.shape)) {
      if (isNodeField(field)) continue;
      const had = from.get(field);
      if (!had) from.set(field, { schema, parent: parent.name });
      else if (had.schema !== schema)
        problems.push(
          `The type ${type.name} inherits ${field} from ${had.parent} and from ${parent.name}, which differ: extend, never override.`,
        );
    }
  for (const field of ownFields.get(type) ?? []) {
    const had = from.get(field);
    if (had)
      problems.push(
        `The type ${type.name} redefines ${field}, a field of its parent ${had.parent}: extend, never override.`,
      );
  }
  return problems;
}

/** A property or a link is a frontmatter key: camelCase. */
const Key = z.string().regex(/^[a-z][A-Za-z0-9]*$/, "a camelCase key");

/** What is wrong with a type: its name, and the names and schemas of its fields. */
function typeProblems(type: Type): string[] {
  const problems = Name.safeParse(type.name).success
    ? []
    : [`The type ${type.name} is not named by a lowercase slug.`];
  const fields = fieldsOf(type);
  const taken = type.extends ? [] : redefinedNode(type);
  const overridden = type.extends ? overriddenBy(type, type.extends) : [];
  if (overridden.length > 0)
    problems.push(
      `The type ${type.name} overrides ${overridden.join(", ")}, a field of the type it extends: extend, never override.`,
    );
  if (taken.length > 0)
    problems.push(
      `The type ${type.name} redefines ${taken.join(", ")}, a field every node has.`,
    );
  if (!type.extends) problems.push(...parentProblems(type));
  const notKeys = Object.keys(fields).filter(
    (field) => !Key.safeParse(field).success,
  );
  if (notKeys.length > 0)
    problems.push(
      `The type ${type.name} has ${notKeys.join(", ")}, which is not a camelCase key.`,
    );
  const notSchemas = Object.entries(fields)
    .filter(([, property]) => !(property instanceof z.ZodType))
    .map(([field]) => field);
  if (notSchemas.length > 0)
    problems.push(
      `The type ${type.name} has ${notSchemas.join(", ")}, which is not a zod schema.`,
    );
  const holdLinks = Object.entries(fields)
    .filter(
      ([, field]) =>
        field instanceof z.ZodType &&
        !links.has(field) &&
        partsOf(field).some((part) => linkParts.has(part)),
    )
    .map(([field]) => field);
  if (holdLinks.length > 0)
    problems.push(
      `The type ${type.name} has ${holdLinks.join(", ")}, which holds a link but is not one: a link is one, oneOrNone, many or manyOrNone with no method chained. An optional one link is oneOrNone, and an optional many link is manyOrNone.`,
    );
  const prototypeNames = Object.keys(fields).filter(isPrototypeName);
  if (prototypeNames.length > 0) {
    problems.push(
      `The type ${type.name} has ${prototypeNames.join(", ")}, a name the object prototype has.`,
    );
  }
  return [...problems, ...keyProblems(type, fields)];
}

export interface Schema<
  T extends Record<string, Type> = Record<string, Type>,
  I extends readonly AnySchema[] = readonly AnySchema[],
> {
  name: string;
  description: string;
  /** Its own types, each by its name. A type that extends an imported one is under that name. */
  types: T;
  /** The schemas it imports: its links can point at their types, and its types can extend them. */
  imports: I;
  /**
   * The folder of its type notes, one for each type of its own, as a file URL: `new URL("./types/", import.meta.url)`.
   * None when it holds no type of its own. `lintFolder` reads it from disk.
   */
  typeNotes?: URL;
  /** Its rules: the checks of its own that the lint runs, beside basis's, on each schema that sees it. */
  rules?: readonly Rule[];
  /**
   * The node, parsed by the zod schema of its type, in the own types of the schema it is called on. Throws when the
   * node does not fit. A node of an imported type is parsed by the schema that holds it. It takes the values of the
   * graph: a link is the name it points at, not a note's `[[name]]`.
   */
  parse<This extends Schema, N extends keyof This["types"] & string>(
    this: This,
    type: N,
    node: unknown,
  ): z.output<This["types"][N]["schema"]>;
}

/** Any schema, as an import: its own imports are any schemas. A type parameter cannot name its own interface. */
export interface AnySchema extends Schema {
  imports: readonly AnySchema[];
}

/** The types a schema sees through its imports, at every depth. */
type TypesSeen<I extends readonly AnySchema[]> = I[number] extends infer P
  ? P extends Schema<infer U, infer J extends readonly AnySchema[]>
    ? U[keyof U] | TypesSeen<J>
    : never
  : never;

/** A type that extends another must extend one its schema sees: one of its imports', or the built-in type. */
type ExtendsSeen<X, I extends readonly AnySchema[]> = X extends {
  extends: Type;
}
  ? { extends: TypesSeen<I> | typeof type }
  : unknown;

/** For each types object, the imports it was checked with. A spread schema is checked on its first parse. */
const checkedWith = new WeakMap<object, WeakSet<object>>();

/** A schema name is a slug. A plain Error, as for the other checks: the lint takes a ZodError as a node's problem. */
function checkName(name: string) {
  if (!Name.safeParse(name).success)
    throw new Error(`The schema ${name} is not named by a lowercase slug.`);
}

/** Whether a type extends another, at any depth. */
const extendsType = (type: Type, other: Type): boolean =>
  type.extends !== undefined &&
  (type.extends === other || extendsType(type.extends, other));

type Layer<P> = {
  name: string;
  types: Record<string, Type>;
  imports: readonly P[];
};

/**
 * The types a schema sees, each by its name, with the schema that holds it: the built-in schema's, its imports' at
 * every depth, then its own. An extension takes the name of what it extends. Throws on a schema named basis that is
 * not the built-in one, on a cycle of imports, by schema name, on two schemas of one name, and on two owners of one
 * type name.
 */
export function seenTypes<P extends Layer<P>>(
  schema: P,
  path: string[] = [],
  schemas = new Map<string, { schema: object; path: string[] }>(),
): Map<string, { type: Type; owner: P | Schema }> {
  // Checked first: a schema of that name would also be seen beside the built-in one, as a cycle or a second schema.
  if (schema.name === "basis" && schema.types !== builtInTypes)
    throw new Error("The schema name basis is basis's own.");
  const here = [...path, schema.name];
  if (path.includes(schema.name))
    throw new Error(
      `The imports of ${path[0]} make a cycle: ${here.join(" imports ")}.`,
    );
  // One owner per schema name, as for types: one object, wherever it is seen.
  const known = schemas.get(schema.name);
  if (known && known.schema !== schema)
    throw new Error(
      `The schema ${here[0]} sees two schemas named ${schema.name}: at ${known.path.join(" > ")}, and at ${here.join(" > ")}.`,
    );
  schemas.set(schema.name, { schema, path: here });
  const seen = new Map<string, { type: Type; owner: P | Schema }>();
  // Every schema sees the built-in one, as if it imported it. The built-in schema, as it is made, sees only itself.
  const imports =
    schema.types === builtInTypes ? schema.imports : [basis, ...schema.imports];
  for (const imported of imports) {
    for (const [name, at] of seenTypes(imported, here, schemas)) {
      const had = seen.get(name);
      if (!had || extendsType(at.type, had.type)) seen.set(name, at);
      else if (had.type !== at.type && !extendsType(had.type, at.type))
        throw new Error(
          `The schema ${schema.name} imports two types named ${name}, from ${had.owner.name} and from ${at.owner.name}, and neither extends the other.`,
        );
    }
  }
  for (const [name, type] of Object.entries(schema.types)) {
    const had = seen.get(name);
    if (had && !extendsType(type, had.type))
      throw new Error(
        `The type ${name} of ${schema.name} has the name of a type of ${had.owner.name}, and does not extend it: a name has one owner.`,
      );
    if (type.extends && !had)
      throw new Error(
        `The type ${name} of ${schema.name} extends ${type.extends.name}, which is not a type of the schema ${schema.name} or its imports.`,
      );
    seen.set(name, { type, owner: schema });
  }
  return seen;
}

/** What defineSchema checks: the name, each type, its imports, and the links between them. Throws on the first kind of problem. */
function checkSchema(
  name: string,
  types: Record<string, Type>,
  imports: readonly AnySchema[],
) {
  checkName(name);
  const entries = Object.entries(types);
  const notMade = entries.filter(([, type]) => !madeTypes.has(type));
  if (notMade.length > 0)
    throw new Error(
      `The schema ${name} has ${notMade.map(([key]) => key).join(", ")}, which defineType did not make.`,
    );
  const problems = entries.flatMap(([key, type]) => [
    ...typeProblems(type),
    ...(key === type.name
      ? []
      : [
          `The schema ${name} has the type ${type.name} under the key ${key}: a type is under its name.`,
        ]),
  ]);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const seen = seenTypes<Schema | Layer<Schema>>({ name, types, imports });
  // Each import as defineSchema checks it: a spread schema is another object, checked on its own first use.
  for (const imported of imports) checked(imported);
  for (const type of entries.map(([, type]) => type)) {
    for (const parent of type.extends ? [] : (type.parents ?? [])) {
      const at = seen.get(parent.name)?.type;
      if (!at || !(at === parent || extendsType(at, parent)))
        throw new Error(
          `The type ${type.name} of ${name} inherits ${parent.name}, which is not a type of the schema ${name} or its imports.`,
        );
    }
    for (const link of linksOf(type)) {
      for (const end of link.to()) {
        // A link to a type the schema sees an extension of: the extension is the same type.
        const at = seen.get(end.name)?.type;
        if (!at || !(at === end || extendsType(at, end)))
          throw new Error(
            `The link ${link.name} of ${type.name} ends at ${end.name}, which is not a type of the schema ${name} or its imports.`,
          );
      }
    }
  }
  const withImports = checkedWith.get(types) ?? new WeakSet();
  withImports.add(Object.freeze(imports));
  checkedWith.set(Object.freeze(types), withImports);
}

/**
 * A schema, checked as defineSchema checks it, once for its types and imports. The name on each call: a schema
 * spread with another name keeps the types and imports that were checked.
 */
export function checked(schema: {
  name: string;
  types: Record<string, Type>;
  imports: readonly AnySchema[];
  typeNotes?: unknown;
}) {
  checkName(schema.name);
  if (!checkedWith.get(schema.types)?.has(schema.imports))
    checkSchema(schema.name, schema.types, schema.imports);
  checkTypeNotes(schema);
}

/** The types a schema holds as their owner: each one but an extension, whose owner is the schema of the type it extends. */
export const ownTypesOf = (types: Record<string, Type>): Type[] =>
  Object.values(types).filter((type) => !type.extends);

/** A schema as defineSchema takes it, or as a config gives it: the parts schemasSeen reads. */
type SchemaParts = {
  name: string;
  types: Record<string, Type>;
  imports: readonly SchemaParts[];
  typeNotes?: unknown;
  rules?: unknown;
};

/** Each schema a schema sees, each one after its imports: the built-in one, its imports at every depth, and itself. */
export function schemasSeen<S extends SchemaParts>(schema: S): S[] {
  // The built-in schema, as it is made, sees only itself.
  const found = new Set<SchemaParts>(
    schema.types === builtInTypes ? [] : [basis],
  );
  const walk = (at: SchemaParts) => {
    if (found.has(at)) return;
    for (const imported of at.imports) walk(imported);
    found.add(at);
  };
  walk(schema);
  return [...found] as S[];
}

/**
 * What defineSchema checks of the folder of type notes: a file URL, there when the schema holds a type of its own, and
 * declared by no other schema it sees (one owner per folder, as per type name). A plain Error, as for the other checks.
 */
function checkTypeNotes(schema: SchemaParts) {
  const { name, typeNotes } = schema;
  const declare = 'typeNotes: new URL("./types/", import.meta.url)';
  if (
    typeNotes !== undefined &&
    !(typeNotes instanceof URL && typeNotes.protocol === "file:")
  )
    throw new Error(
      `The folder of type notes of ${name} is not a file URL: ${declare}.`,
    );
  const own = ownTypesOf(schema.types).map((type) => type.name);
  if (typeNotes === undefined && own.length > 0)
    throw new Error(
      `The schema ${name} holds the type${own.length > 1 ? "s" : ""} ${own.join(", ")} of its own, and declares no folder of type notes: defineSchema({ ..., ${declare} }).`,
    );
  const owners = new Map<string, string>();
  for (const at of schemasSeen(schema)) {
    if (!(at.typeNotes instanceof URL)) continue;
    const folder = resolve(fileURLToPath(at.typeNotes));
    const had = owners.get(folder);
    if (had !== undefined && had !== at.name)
      throw new Error(
        `The schemas ${had} and ${at.name} both declare ${folder} as the folder of their type notes: a folder has one owner.`,
      );
    owners.set(folder, at.name);
  }
}

/**
 * The nodes a rule can read: each node that parsed, its own too, by its name or by its type. A node of a type is one
 * of that type, of an extension of it, or of a type that inherits one of those. The type is one the schema sees.
 */
export interface Graph {
  /** The node of that name, when one node has it, it parsed, and it is of the type. Otherwise none. */
  get<T extends Type>(name: string, type: T): z.output<T["schema"]> | undefined;
  /** Each node of the type, in path order. */
  all<T extends Type>(type: T): z.output<T["schema"]>[];
}

/**
 * A check a schema brings, beside basis's own (the ESLint model: a small core, rules from plugins). It runs on each
 * node of its type that parsed, and gives what is wrong. Its name is unique in its schema, and its id is
 * `<schema>/<name>`, as ESLint's `plugin/rule`.
 */
export type Rule = {
  name: string;
  description: string;
  /** The type it runs on: each node of it, or of a type that inherits it. */
  on: Type;
  check: (node: never, graph: Graph) => readonly Report[];
};

/** One thing a rule finds wrong: the field of the node it is in, as a path ("states.0"), if one, and what is wrong. */
export type Report = { field?: string; message: string };

const madeRules = new WeakSet<object>();

/** A rule: its name, what it checks, the type it runs on, and the check. The check gets the node parsed by its type. */
export function defineRule<const T extends Type>(rule: {
  name: string;
  description: string;
  on: T;
  check: (node: z.output<T["schema"]>, graph: Graph) => readonly Report[];
}): Rule {
  if (!Name.safeParse(rule.name).success)
    throw new Error(`The rule ${rule.name} is not named by a lowercase slug.`);
  if (!nodeShape.description.safeParse(rule.description).success)
    throw new Error(`The rule ${rule.name} has no description.`);
  if (!madeTypes.has(rule.on))
    throw new Error(
      `The rule ${rule.name} runs on ${String((rule.on as { name?: unknown } | undefined)?.name)}, which defineType did not make.`,
    );
  if (typeof rule.check !== "function")
    throw new Error(`The rule ${rule.name} has no check function.`);
  const made: Rule = Object.freeze({
    name: rule.name,
    description: rule.description,
    on: rule.on,
    check: rule.check,
  });
  madeRules.add(made);
  return made;
}

/**
 * Whether a node of one type is a node of another: the same type, an extension of it, or a type that inherits one of
 * those. By the types themselves, not their names: a type that inherits a type an extension extends does not have the
 * extension's fields.
 */
export const isOfType = (type: Type, of: Type): boolean =>
  type === of ||
  extendsType(type, of) ||
  (type.parents ?? []).some((parent) => isOfType(parent, of));

/** Whether a schema sees a type: the type it sees by that name is the type, or extends it. */
export const seesType = (
  seen: Map<string, { type: Type }>,
  type: Type,
): boolean => {
  const at = seen.get(type.name)?.type;
  return at !== undefined && (at === type || extendsType(at, type));
};

/**
 * What defineSchema checks of the rules of a schema and of each schema it sees, as it checks each import's types: a
 * list, each made by defineRule, each on a type its schema sees, and no two of one name in one schema. A plain Error,
 * as for the other checks.
 */
export function checkRules(schema: SchemaParts) {
  for (const at of schemasSeen(schema)) {
    const { name, rules } = at;
    if (rules === undefined) continue;
    if (!Array.isArray(rules))
      throw new Error(`The rules of ${name} are not a list.`);
    const seen = seenTypes(at);
    const names = new Set<string>();
    for (const rule of rules as unknown[]) {
      if (typeof rule !== "object" || rule === null || !madeRules.has(rule))
        throw new Error(
          `The schema ${name} has the rule ${String((rule as { name?: unknown } | null)?.name)}, which defineRule did not make.`,
        );
      const { name: ruleName, on } = rule as Rule;
      if (names.has(ruleName))
        throw new Error(`The schema ${name} has two rules named ${ruleName}.`);
      names.add(ruleName);
      if (!seesType(seen, on))
        throw new Error(
          `The rule ${name}/${ruleName} runs on ${on.name}, which is not a type of the schema ${name} or its imports.`,
        );
    }
  }
}

/** The rules of each schema a schema sees, with the schema that holds each. checkRules has checked them. */
export const rulesSeen = (schema: Schema): { rule: Rule; owner: Schema }[] =>
  schemasSeen(schema).flatMap((owner) =>
    (owner.rules ?? []).map((rule) => ({ rule, owner })),
  );

/** A type by its key. Generic, so the type is the one under that key, not any type of the record. */
const typeIn = <T extends Record<string, Type>, K extends keyof T>(
  types: T,
  key: K,
): T[K] => types[key];

/**
 * One schema: its types, each under its own name, and through their fields the links between them, and the schemas
 * it imports. It checks every type it holds, however it was made, and throws before any node is read.
 */
export function defineSchema<
  const T extends Record<string, Type> & {
    [K in keyof T]: { name: K } & ExtendsSeen<T[K], I>;
  },
  const I extends readonly AnySchema[] = readonly [],
>(schema: {
  name: string;
  description: string;
  types: T;
  imports?: I;
  typeNotes?: URL;
  rules?: readonly Rule[];
}): Schema<T, I | readonly []> {
  const imports = schema.imports ?? [];
  checkSchema(schema.name, schema.types, imports);
  checkTypeNotes({ ...schema, imports });
  checkRules({ ...schema, imports });
  return {
    ...schema,
    imports,
    ...(schema.rules && { rules: Object.freeze([...schema.rules]) }),
    parse<This extends Schema, N extends keyof This["types"] & string>(
      this: This,
      type: N,
      node: unknown,
    ) {
      checked(this);
      if (!Object.hasOwn(this.types, type))
        throw new Error(`The schema ${this.name} has no type ${type}.`);
      const held = typeIn(this.types, type);
      if (held.abstract)
        throw new Error(
          `The type ${type} is abstract: a node is of a type that inherits it.`,
        );
      const typeSchema: This["types"][N]["schema"] = held.schema;
      return typeSchema.parse(node);
    },
  };
}

/**
 * The type of a type note: the note that explains one type, as a docstring explains a function. It is basis's own,
 * as node is, so every schema sees it (GraphQL's built-in __Type).
 */
export const type = defineType({
  name: "type",
  description:
    "A note that explains one type of a schema: what it is for, and when to use it over the others. Its body is the template a new note of that type starts from.",
  fields: {
    abstract: z
      .literal(true)
      .optional()
      .describe(
        "true when the type is abstract: no note is of it, only of the types that inherit it",
      ),
  },
});

const builtInTypes = { type };

/** The built-in schema: the types every schema sees without an import. */
export const basis = defineSchema({
  name: "basis",
  description: "The types basis gives every schema: the type of a type note.",
  types: builtInTypes,
  typeNotes: new URL("../types/", import.meta.url),
});
