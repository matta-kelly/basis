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

/** A kind of node, and the fields its nodes carry beside the base. A type cannot change a field of the base. */
export function defineType<const T extends Type>(type: T): T {
  Name.parse(type.name);
  const taken = Object.keys(type.properties).filter(isBaseField);
  if (taken.length > 0) {
    throw new Error(
      `The type ${type.name} redefines ${taken.join(", ")}, a field of the base.`,
    );
  }
  return type;
}

export type Link = {
  name: string;
  description: string;
  from: Type;
  to: Type;
  /** one: a node points at one node. many: at one or more. */
  cardinality: "one" | "many";
};

/** An edge between two types. It is stored on the node it starts from, under its own name. */
export function defineLink<const L extends Link>(link: L): L {
  if (
    isBaseField(link.name) ||
    Object.hasOwn(link.from.properties, link.name)
  ) {
    throw new Error(
      `The link ${link.name} has the name of a field of ${link.from.name}.`,
    );
  }
  return link;
}

export type Package = {
  name: string;
  description: string;
  types: Type[];
  links: Link[];
  /** The node, parsed by the schema of its type. Throws when the node does not fit. */
  parse(type: string, node: unknown): Record<string, unknown>;
};

/** One package: its types, and the links between them. Each type has one name, and each link ends at a type of the package. */
export function definePackage(pkg: Omit<Package, "parse">): Package {
  Name.parse(pkg.name);
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
          .map((link) => [
            link.name,
            link.cardinality === "one" ? wikilink : z.array(wikilink).min(1),
          ]),
      );
      return [
        type.name,
        z.strictObject({
          ...base,
          type: z.literal(type.name),
          ...type.properties,
          ...links,
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
