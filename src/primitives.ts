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
export const wikilink = z
  .string()
  .regex(/^\[\[[a-z][a-z0-9-]*\]\]$/, 'a wikilink, "[[name]]"')
  .transform((link) => link.slice(2, -2));

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

/** What a link points at: a thunk, so a link can point at a type defined later. */
export type Link = { to: () => Type; cardinality: "one" | "many" };

/** The target of each link schema, kept beside the schema and not in its type. */
const links = new WeakMap<object, Link>();

function link<S extends z.ZodType>(schema: S, target: Link): S {
  links.set(schema, target);
  return schema;
}

/** A link to one node. */
export const one = (to: () => Type) =>
  link(wikilink.clone(), { to, cardinality: "one" });

/** A link to one or more nodes. */
export const many = (to: () => Type) =>
  link(z.array(wikilink).min(1), { to, cardinality: "many" });

/** A link to any number of nodes: no value and an empty list both mean none. */
export const manyOrNone = (to: () => Type) =>
  link(z.array(wikilink).optional(), { to, cardinality: "many" });

/** The links that start from a type: each of its fields made by one, many or manyOrNone. */
export const linksOf = (type: Type) =>
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
  /** The node, parsed by the schema of its type. Throws when the node does not fit. */
  parse<N extends keyof T & string>(
    type: N,
    node: unknown,
  ): z.output<T[N]["schema"]>;
};

/**
 * One package: its types, each under its own name, and through their fields the links between them.
 * It checks every type it holds, however it was made, and throws before any note is read.
 */
export function definePackage<
  const T extends Record<string, Type> & { [K in keyof T]: { name: K } },
>(pkg: { name: string; description: string; types: T }): Package<T> {
  Name.parse(pkg.name);
  const types = Object.entries(pkg.types);
  const notMade = types.filter(([, type]) => !madeTypes.has(type));
  if (notMade.length > 0)
    throw new Error(
      `The package ${pkg.name} has ${notMade.map(([key]) => key).join(", ")}, which defineType did not make.`,
    );
  const problems = types.flatMap(([key, type]) => [
    ...typeProblems(type),
    ...(key === type.name
      ? []
      : [
          `The package ${pkg.name} has the type ${type.name} under the key ${key}: a type is under its name.`,
        ]),
  ]);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const held = types.map(([, type]) => type);
  for (const type of held) {
    for (const { name, to } of linksOf(type)) {
      const end = to();
      if (!held.includes(end))
        throw new Error(
          `The link ${name} of ${type.name} ends at ${end.name}, which is not a type of the package ${pkg.name}.`,
        );
    }
  }

  return {
    ...pkg,
    parse<N extends keyof T & string>(type: N, node: unknown) {
      if (!Object.hasOwn(pkg.types, type))
        throw new Error(`The package ${pkg.name} has no type ${type}.`);
      const schema: T[N]["schema"] = pkg.types[type].schema;
      return schema.parse(node);
    },
  };
}
