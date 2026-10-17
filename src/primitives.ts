/**
 * The primitives as code: a type, a link, and a package that holds them.
 * A node is a note: its frontmatter holds its fields, and its file name is its name.
 * The world is closed: a node carries the fields of its type, its properties and the links
 * that start from it, and nothing else.
 */

import * as z from "zod";

/** A node is named by a short slug, so one node can point at another by name. */
export const Name = z.string().regex(/^[a-z][a-z0-9-]*$/, "a lowercase slug");

/** What every node carries, whatever its type. Every type extends it, and fixes the value of `type` to its own name. */
export const base = {
  name: Name,
  type: Name,
  description: z.string().min(1),
};

const isBaseField = (field: string) => Object.hasOwn(base, field);

/** A name the object prototype has (`constructor`, `toString`). A parse reads `node[name]`, and would find the prototype's value. */
const isPrototypeName = (field: string) =>
  Object.hasOwn(Object.prototype, field);

/** A pointer to another node, as a note writes it: "[[name]]". Parsed to the name. */
const wikilinkOf = () =>
  z
    .string()
    .regex(/^\[\[[a-z][a-z0-9-]*\]\]$/, 'a wikilink, "[[name]]"')
    .transform((link) => link.slice(2, -2));
export const wikilink = wikilinkOf();

/**
 * A schema, the schemas inside it, and their defs: found by walking each def's values, its arrays and plain objects,
 * and the schema a lazy schema returns. A method chained on a schema wraps it, or makes a clone that keeps its def
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

/** A kind of node: the one closed schema of its nodes, the base and its fields. */
export type Type = {
  name: string;
  description: string;
  schema: z.ZodObject;
  /** The type it extends: the same kind of note, with more fields. */
  extends?: Type;
};

/** The types defineType made. A package holds no other: a type's schema is made from its fields, once. */
const madeTypes = new WeakSet<Type>();

/** A kind of node, and the fields its nodes carry beside the base. The package that holds it checks it. */
export function defineType<
  const N extends string,
  const F extends z.ZodRawShape,
>(type: { name: N; description: string; fields: F }) {
  // One copy of the fields, so each getter is read once. zod copies the shape again: the schema is the one description.
  const fields: F = { ...type.fields };
  const made = Object.freeze({
    name: type.name,
    description: type.description,
    // The fields last: spread before them, the literal keeps its type. A field named type is refused by the package.
    schema: z.strictObject({ ...base, type: z.literal(type.name), ...fields }),
  });
  madeTypes.add(made);
  return made;
}

/**
 * A type that extends another: the same kind of note, under the base's name and description, with the base's fields
 * and more. Its schema is the base's, extended by zod. The package that holds it checks it.
 * The base's shape and config are inferred from its schema, so the extension's schema is zod's own type for it.
 */
export function extendType<
  B extends Type,
  S extends z.ZodRawShape,
  C extends z.core.$ZodObjectConfig,
  const F extends z.ZodRawShape,
>(
  extended: B & { schema: z.ZodObject<S, C> },
  type: {
    /** No field of the base: extend, never override. */
    fields: F & { [K in keyof S]?: never };
  },
) {
  const fields: F = { ...type.fields };
  const parent: B = extended;
  const name: B["name"] = parent.name;
  const schema: z.ZodObject<S, C> = extended.schema;
  const made = Object.freeze({
    name,
    description: parent.description,
    extends: parent,
    schema: schema.extend(fields),
  });
  madeTypes.add(made);
  return made;
}

/** A link: the field it is, what it points at, how many, and whether a node can leave it out. */
export type Link = {
  name: string;
  /** A thunk, so a link can point at a type defined later. */
  to: () => Type;
  cardinality: "one" | "many";
  optional: boolean;
};

/** The target of each link schema, kept beside the schema and not in its type. */
const links = new WeakMap<object, Omit<Link, "name">>();

/** Each part of each link schema. Each link is made of new schemas, so a part is in no other schema but one made from the link. */
const linkParts = new WeakSet<object>();

function link<S extends z.ZodType>(schema: S, target: Omit<Link, "name">): S {
  links.set(schema, target);
  for (const part of partsOf(schema)) linkParts.add(part);
  return schema;
}

/** A link to one node. */
export const one = (to: () => Type) =>
  link(wikilinkOf(), { to, cardinality: "one", optional: false });

/** A link to one node or none: the key holds a name, or is absent. */
export const oneOrNone = (to: () => Type) =>
  link(wikilinkOf().optional(), { to, cardinality: "one", optional: true });

/** A link to one or more nodes. */
export const many = (to: () => Type) =>
  link(z.array(wikilinkOf()).min(1), {
    to,
    cardinality: "many",
    optional: false,
  });

/** A link to any number of nodes: an absent key and an empty list both mean none. */
export const manyOrNone = (to: () => Type) =>
  link(z.array(wikilinkOf()).optional(), {
    to,
    cardinality: "many",
    optional: true,
  });

/** The links that start from a type: each of its fields made by one, oneOrNone, many or manyOrNone. */
export const linksOf = (type: Type): Link[] =>
  Object.entries(fieldsOf(type)).flatMap(([name, schema]) => {
    const target = links.get(schema);
    return target ? [{ name, ...target }] : [];
  });

/** A type's fields: its schema's shape, without the base. */
function fieldsOf(type: Type): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(type.schema.shape).filter(([field]) => !isBaseField(field)),
  );
}

/** The base fields a type's fields replaced: the shape has another schema there than the base's, or than its literal. */
function redefinedBase(type: Type): string[] {
  const shape = type.schema.shape;
  const literal = shape.type;
  return [
    ...(shape.name === base.name ? [] : ["name"]),
    ...(shape.description === base.description ? [] : ["description"]),
    ...(literal instanceof z.ZodLiteral && literal.value === type.name
      ? []
      : ["type"]),
  ];
}

/** The fields of a base whose schema in the extension is not the base's own. */
function overriddenBy(type: Type, extended: Type): string[] {
  const shape = type.schema.shape;
  return Object.entries(extended.schema.shape)
    .filter(([field, schema]) => shape[field] !== schema)
    .map(([field]) => field);
}

/** A property or a link is a frontmatter key: camelCase. */
const Key = z.string().regex(/^[a-z][A-Za-z0-9]*$/, "a camelCase key");

/** What is wrong with a type: its name, and the names and schemas of its fields. */
function typeProblems(type: Type): string[] {
  const problems = Name.safeParse(type.name).success
    ? []
    : [`The type ${type.name} is not named by a lowercase slug.`];
  const fields = fieldsOf(type);
  const taken = type.extends ? [] : redefinedBase(type);
  const overridden = type.extends ? overriddenBy(type, type.extends) : [];
  if (overridden.length > 0)
    problems.push(
      `The type ${type.name} overrides ${overridden.join(", ")}, a field of the type it extends: extend, never override.`,
    );
  if (taken.length > 0)
    problems.push(
      `The type ${type.name} redefines ${taken.join(", ")}, a field of the base.`,
    );
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
  return problems;
}

export interface Package<
  T extends Record<string, Type> = Record<string, Type>,
  I extends readonly AnyPackage[] = readonly AnyPackage[],
> {
  name: string;
  description: string;
  /** Its own types, each by its name. A type that extends an imported one is under that name. */
  types: T;
  /** The packages it imports: its links can point at their types, and its types can extend them. */
  imports: I;
  /**
   * The node, parsed by the schema of its type, in the own types of the package it is called on. Throws when the
   * node does not fit. A note of an imported type is parsed by the package that holds it.
   */
  parse<This extends Package, N extends keyof This["types"] & string>(
    this: This,
    type: N,
    node: unknown,
  ): z.output<This["types"][N]["schema"]>;
}

/** Any package, as an import: its own imports are any packages. A type parameter cannot name its own interface. */
export interface AnyPackage extends Package {
  imports: readonly AnyPackage[];
}

/** The types a package sees through its imports, at every depth. */
type TypesSeen<I extends readonly AnyPackage[]> = I[number] extends infer P
  ? P extends Package<infer U, infer J extends readonly AnyPackage[]>
    ? U[keyof U] | TypesSeen<J>
    : never
  : never;

/** A type that extends another must extend one its package sees. */
type ExtendsSeen<X, I extends readonly AnyPackage[]> = X extends {
  extends: Type;
}
  ? { extends: TypesSeen<I> }
  : unknown;

/** For each types object, the imports it was checked with. A spread package is checked on its first parse. */
const checked = new WeakMap<object, WeakSet<object>>();

/** A package name is a slug. A plain Error, as for the other checks: the lint takes a ZodError as a note's problem. */
function checkName(name: string) {
  if (!Name.safeParse(name).success)
    throw new Error(`The package ${name} is not named by a lowercase slug.`);
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
 * The types a package sees, each by its name, with the package that holds it: its imports' at every depth, then its
 * own. An extension takes the name of what it extends. Throws on a cycle of imports, by package name, and on two
 * owners of one name.
 */
export function seenTypes<P extends Layer<P>>(
  pkg: P,
  path: string[] = [],
): Map<string, { type: Type; owner: P }> {
  if (path.includes(pkg.name))
    throw new Error(
      `The imports of ${path[0]} make a cycle: ${[...path, pkg.name].join(" imports ")}.`,
    );
  const seen = new Map<string, { type: Type; owner: P }>();
  for (const imported of pkg.imports) {
    for (const [name, at] of seenTypes(imported, [...path, pkg.name])) {
      const had = seen.get(name);
      if (!had || extendsType(at.type, had.type)) seen.set(name, at);
      else if (had.type !== at.type && !extendsType(had.type, at.type))
        throw new Error(
          `The package ${pkg.name} imports two types named ${name}, from ${had.owner.name} and from ${at.owner.name}, and neither extends the other.`,
        );
    }
  }
  for (const [name, type] of Object.entries(pkg.types)) {
    const had = seen.get(name);
    if (had && !extendsType(type, had.type))
      throw new Error(
        `The type ${name} of ${pkg.name} has the name of a type of ${had.owner.name}, and does not extend it: a name has one owner.`,
      );
    if (type.extends && !had)
      throw new Error(
        `The type ${name} of ${pkg.name} extends ${type.extends.name}, which is not a type of the package ${pkg.name} or its imports.`,
      );
    seen.set(name, { type, owner: pkg });
  }
  return seen;
}

/** What definePackage checks: the name, each type, its imports, and the links between them. Throws on the first kind of problem. */
function checkPackage(
  name: string,
  types: Record<string, Type>,
  imports: readonly AnyPackage[],
) {
  checkName(name);
  const entries = Object.entries(types);
  const notMade = entries.filter(([, type]) => !madeTypes.has(type));
  if (notMade.length > 0)
    throw new Error(
      `The package ${name} has ${notMade.map(([key]) => key).join(", ")}, which defineType did not make.`,
    );
  const problems = entries.flatMap(([key, type]) => [
    ...typeProblems(type),
    ...(key === type.name
      ? []
      : [
          `The package ${name} has the type ${type.name} under the key ${key}: a type is under its name.`,
        ]),
  ]);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const seen = seenTypes<Package | Layer<Package>>({ name, types, imports });
  // Each import as definePackage checks it: a spread package is another object, checked on its own first use.
  for (const imported of imports)
    if (!isChecked(imported.types, imported.imports))
      checkPackage(imported.name, imported.types, imported.imports);
  for (const type of entries.map(([, type]) => type)) {
    for (const link of linksOf(type)) {
      const end = link.to();
      // A link to a base the package sees an extension of: the extension is the same kind of note.
      const at = seen.get(end.name)?.type;
      if (!at || !(at === end || extendsType(at, end)))
        throw new Error(
          `The link ${link.name} of ${type.name} ends at ${end.name}, which is not a type of the package ${name} or its imports.`,
        );
    }
  }
  const withImports = checked.get(types) ?? new WeakSet();
  withImports.add(Object.freeze(imports));
  checked.set(Object.freeze(types), withImports);
}

const isChecked = (types: object, imports: object) =>
  checked.get(types)?.has(imports) ?? false;

/** A type by its key. Generic, so the type is the one under that key, not any type of the record. */
const typeIn = <T extends Record<string, Type>, K extends keyof T>(
  types: T,
  key: K,
): T[K] => types[key];

/**
 * One package: its types, each under its own name, and through their fields the links between them, and the packages
 * it imports. It checks every type it holds, however it was made, and throws before any note is read.
 */
export function definePackage<
  const T extends Record<string, Type> & {
    [K in keyof T]: { name: K } & ExtendsSeen<T[K], I>;
  },
  const I extends readonly AnyPackage[] = readonly [],
>(pkg: {
  name: string;
  description: string;
  types: T;
  imports?: I;
}): Package<T, I | readonly []> {
  const imports = pkg.imports ?? [];
  checkPackage(pkg.name, pkg.types, imports);
  return {
    ...pkg,
    imports,
    parse<This extends Package, N extends keyof This["types"] & string>(
      this: This,
      type: N,
      node: unknown,
    ) {
      // The name on each parse: a package spread with another name keeps the types that were checked.
      checkName(this.name);
      if (!isChecked(this.types, this.imports))
        checkPackage(this.name, this.types, this.imports);
      if (!Object.hasOwn(this.types, type))
        throw new Error(`The package ${this.name} has no type ${type}.`);
      const schema: This["types"][N]["schema"] = typeIn(
        this.types,
        type,
      ).schema;
      return schema.parse(node);
    },
  };
}
