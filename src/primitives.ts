/**
 * The primitives as code: a type, a link, and a package that holds them.
 * A node is a note: its frontmatter holds its fields, and its file name is its name.
 * The world is closed: a node carries the fields of its type and the links that start
 * from it, and nothing else.
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
const wikilink = z
  .string()
  .regex(/^\[\[[a-z][a-z0-9-]*\]\]$/, 'a wikilink, "[[name]]"')
  .transform((link) => link.slice(2, -2));

export type Type = {
  name: string;
  description: string;
  properties: z.ZodRawShape;
};

/** A kind of node, and the fields its nodes carry beside the base. The package that holds it checks it. */
export function defineType<const T extends Type>(type: T): T {
  return type;
}

export type Link = {
  name: string;
  description: string;
  from: Type;
  to: Type;
  /** one: a node points at one node. many: at one or more. */
  cardinality: "one" | "many";
  /** false: a node of the from type can leave it out. Required when not given. */
  required?: boolean;
};

/** An edge between two types. It is stored on the node it starts from, under its own name. The package that holds it checks it. */
export function defineLink<const L extends Link>(link: L): L {
  return link;
}

/** A link is a frontmatter key: camelCase. */
const LinkName = z.string().regex(/^[a-z][A-Za-z0-9]*$/, "a camelCase key");

/** What is wrong with a type, whatever made it. */
function typeProblems(type: Type): string[] {
  const problems = Name.safeParse(type.name).success
    ? []
    : [`The type ${type.name} is not named by a lowercase slug.`];
  const taken = Object.keys(type.properties).filter(isBaseField);
  if (taken.length > 0)
    problems.push(
      `The type ${type.name} redefines ${taken.join(", ")}, a field of the base.`,
    );
  const notSchemas = Object.entries(type.properties)
    .filter(([, property]) => !(property instanceof z.ZodType))
    .map(([field]) => field);
  if (notSchemas.length > 0)
    problems.push(
      `The type ${type.name} has ${notSchemas.join(", ")}, which is not a zod schema.`,
    );
  const prototypeNames = Object.keys(type.properties).filter(isPrototypeName);
  if (prototypeNames.length > 0) {
    problems.push(
      `The type ${type.name} has ${prototypeNames.join(", ")}, a name the object prototype has.`,
    );
  }
  return problems;
}

/** What is wrong with a link, whatever made it. */
function linkProblems(link: Link): string[] {
  const problems = LinkName.safeParse(link.name).success
    ? []
    : [`The link "${link.name}" is not named by a camelCase key.`];
  if (
    isBaseField(link.name) ||
    Object.hasOwn(link.from.properties, link.name)
  ) {
    problems.push(
      `The link ${link.name} has the name of a field of ${link.from.name}.`,
    );
  }
  if (isPrototypeName(link.name))
    problems.push(`The link ${link.name} has a name the object prototype has.`);
  if (link.cardinality !== "one" && link.cardinality !== "many") {
    problems.push(
      `The link ${link.name} has the cardinality ${String(link.cardinality)}: it is one or many.`,
    );
  }
  if (link.required !== undefined && typeof link.required !== "boolean") {
    problems.push(
      `The link ${link.name} has required ${String(link.required)}: it is true or false.`,
    );
  }
  return problems;
}

export type Package = {
  name: string;
  description: string;
  types: Type[];
  links: Link[];
  /** The node, parsed by the schema of its type. Throws when the node does not fit. */
  parse(type: string, node: unknown): Record<string, unknown>;
};

/**
 * One package: its types, and the links between them. It checks every type and link it holds,
 * however they were made, and throws before any note is read.
 */
export function definePackage(pkg: Omit<Package, "parse">): Package {
  Name.parse(pkg.name);
  const problems = [
    ...pkg.types.flatMap(typeProblems),
    ...pkg.links.flatMap(linkProblems),
  ];
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const names = pkg.types.map((type) => type.name);
  const twice = names.filter((name, i) => names.indexOf(name) !== i);
  if (twice.length > 0)
    throw new Error(
      `The package ${pkg.name} has two types named ${twice.join(", ")}.`,
    );
  const links = pkg.links.map((link) => `${link.from.name}.${link.name}`);
  const twiceLinked = links.filter((link, i) => links.indexOf(link) !== i);
  if (twiceLinked.length > 0)
    throw new Error(
      `The package ${pkg.name} has two links named ${twiceLinked.join(", ")}.`,
    );
  for (const link of pkg.links) {
    for (const end of [link.from, link.to]) {
      if (!pkg.types.includes(end)) {
        throw new Error(
          `The link ${link.name} ends at ${end.name}, which is not a type of the package ${pkg.name}.`,
        );
      }
    }
  }

  // The schema of each type: the base, its properties, and the links that start from it.
  const schemas = new Map(
    pkg.types.map((type) => {
      const links = Object.fromEntries(
        pkg.links
          .filter((link) => link.from === type)
          .map((link) => {
            const schema =
              link.cardinality === "one" ? wikilink : z.array(wikilink).min(1);
            return [
              link.name,
              link.required === false ? schema.optional() : schema,
            ];
          }),
      );
      return [
        type.name,
        z.strictObject({
          ...base,
          ...type.properties,
          ...links,
          // Last, so nothing replaces it.
          type: z.literal(type.name),
        }),
      ];
    }),
  );

  return {
    ...pkg,
    parse(type, node) {
      const schema = schemas.get(type);
      if (!schema)
        throw new Error(`The package ${pkg.name} has no type ${type}.`);
      return schema.parse(node);
    },
  };
}
