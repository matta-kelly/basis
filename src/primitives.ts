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
  const walk = (value: unknown) => {
    if (typeof value !== "object" || value === null || found.has(value)) return;
    if (value instanceof z.ZodType) {
      found.add(value);
      walk(value._zod.def);
      if (value instanceof z.ZodLazy) walk(value.unwrap());
    } else if (
      Array.isArray(value) ||
      [Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      found.add(value);
      Object.values(value).forEach(walk);
    }
  };
  walk(schema);
  return [...found];
}

/** A kind of node: its fields beside the base, and the one closed schema they make. */
export type Type = {
  name: string;
  description: string;
  /** Its properties and the links that start from it, by name. */
  fields: z.ZodRawShape;
  schema: z.ZodType;
};

/** The types defineType made. A package holds no other: a type's schema is made from its fields, once. */
const madeTypes = new WeakSet<Type>();

/** A kind of node, and the fields its nodes carry beside the base. The package that holds it checks it. */
export function defineType<
  const N extends string,
  const F extends z.ZodRawShape,
>(type: { name: N; description: string; fields: F }) {
  const made = {
    ...type,
    // The fields last: spread before them, the literal keeps its type. A field named type is refused by the package.
    schema: z.strictObject({
      ...base,
      type: z.literal(type.name),
      ...type.fields,
    }),
  };
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
  Object.entries(type.fields).flatMap(([name, schema]) => {
    const target = links.get(schema);
    return target ? [{ name, ...target }] : [];
  });

/** A property or a link is a frontmatter key: camelCase. */
const Key = z.string().regex(/^[a-z][A-Za-z0-9]*$/, "a camelCase key");

/** What is wrong with a type: its name, and the names and schemas of its fields. */
function typeProblems(type: Type): string[] {
  const problems = Name.safeParse(type.name).success
    ? []
    : [`The type ${type.name} is not named by a lowercase slug.`];
  const taken = Object.keys(type.fields).filter(isBaseField);
  if (taken.length > 0)
    problems.push(
      `The type ${type.name} redefines ${taken.join(", ")}, a field of the base.`,
    );
  const notKeys = Object.keys(type.fields).filter(
    (field) => !Key.safeParse(field).success,
  );
  if (notKeys.length > 0)
    problems.push(
      `The type ${type.name} has ${notKeys.join(", ")}, which is not a camelCase key.`,
    );
  const notSchemas = Object.entries(type.fields)
    .filter(([, property]) => !(property instanceof z.ZodType))
    .map(([field]) => field);
  if (notSchemas.length > 0)
    problems.push(
      `The type ${type.name} has ${notSchemas.join(", ")}, which is not a zod schema.`,
    );
  const holdLinks = Object.entries(type.fields)
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
  const prototypeNames = Object.keys(type.fields).filter(isPrototypeName);
  if (prototypeNames.length > 0) {
    problems.push(
      `The type ${type.name} has ${prototypeNames.join(", ")}, a name the object prototype has.`,
    );
  }
  return problems;
}

export type Package<T extends Record<string, Type> = Record<string, Type>> = {
  name: string;
  description: string;
  /** Its types, each by its name. */
  types: T;
  /**
   * The node, parsed by the schema of its type, in the types of the package it is called on. Throws when the node
   * does not fit.
   */
  parse<This extends Package, N extends keyof This["types"] & string>(
    this: This,
    type: N,
    node: unknown,
  ): z.output<This["types"][N]["schema"]>;
};

/** The types objects checked as a package's types. A package spread with other types is checked on its first parse. */
const checkedTypes = new WeakSet<object>();

/** What definePackage checks: the name, each type, and the links between them. Throws on the first kind of problem. */
function checkPackage(name: string, types: Record<string, Type>) {
  Name.parse(name);
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
  const held = entries.map(([, type]) => type);
  for (const type of held) {
    for (const link of linksOf(type)) {
      const end = link.to();
      if (!held.includes(end))
        throw new Error(
          `The link ${link.name} of ${type.name} ends at ${end.name}, which is not a type of the package ${name}.`,
        );
    }
  }
  checkedTypes.add(types);
}

/** A type by its key. Generic, so the type is the one under that key, not any type of the record. */
const typeIn = <T extends Record<string, Type>, K extends keyof T>(
  types: T,
  key: K,
): T[K] => types[key];

/**
 * One package: its types, each under its own name, and through their fields the links between them.
 * It checks every type it holds, however it was made, and throws before any note is read.
 */
export function definePackage<
  const T extends Record<string, Type> & { [K in keyof T]: { name: K } },
>(pkg: { name: string; description: string; types: T }): Package<T> {
  checkPackage(pkg.name, pkg.types);
  return {
    ...pkg,
    parse<This extends Package, N extends keyof This["types"] & string>(
      this: This,
      type: N,
      node: unknown,
    ) {
      if (!checkedTypes.has(this.types)) checkPackage(this.name, this.types);
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
