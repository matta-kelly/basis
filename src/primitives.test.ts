import { describe, expect, it } from "vitest";
import * as z from "zod";
import things, { externalObject, object, source } from "../fixtures/things.ts";
import {
  definePackage,
  defineType,
  linksOf,
  many,
  manyOrNone,
  one,
  oneOrNone,
  type Type,
} from "./index.ts";

// The frontmatter of four notes in ~/cc/ontology, as it is in the notes, with `name` added
// from the file name, as the loader gives it.
const fabric = {
  name: "fabric",
  type: "object",
  description: "One print on one cloth. A swatch.",
  key: "fabric_code",
  livesIn: ["[[sheets]]", "[[warehouse]]"],
  schema: "packages/warehouse/schema.ts#Fabric",
  states: ["drafted", "complete", "synced", "stale"],
  derived: ["synced", "stale"],
  representedAs: ["[[odoo-attribute-value]]"],
};
const sheets = {
  name: "sheets",
  type: "source",
  description:
    "Where product information is typed: Google Sheets, the Product Data sheet. One tab per table, loose on purpose.",
  role: "entry",
};
const attributeValue = {
  name: "odoo-attribute-value",
  type: "external-object",
  description:
    "A fabric as Odoo holds it: a value of the print attribute its material picks.",
  heldIn: "[[odoo]]",
  schema: "packages/odoo/schema.ts#AttributeValue",
};

const faire = {
  name: "faire",
  type: "source",
  description:
    "The wholesale marketplace. A projection; no connector is built yet.",
  role: "projection",
  kind: "marketplace",
};

const without = (node: Record<string, unknown>, field: string) =>
  Object.fromEntries(Object.entries(node).filter(([key]) => key !== field));

describe("a node", () => {
  it("parses with the base, its type's properties and its links, and its links come back as names", () => {
    expect(things.parse("object", fabric)).toEqual({
      ...fabric,
      livesIn: ["sheets", "warehouse"],
      representedAs: ["odoo-attribute-value"],
    });
    expect(things.parse("source", sheets)).toEqual(sheets);
    expect(things.parse("source", faire)).toEqual(faire);
    expect(things.parse("external-object", attributeValue)).toEqual({
      ...attributeValue,
      heldIn: "odoo",
    });
    expect(
      things.parse("external-object", {
        ...attributeValue,
        issues: ["a known gap"],
      }),
    ).toMatchObject({ issues: ["a known gap"] });
  });

  it("parses with an optional link absent or empty, and is refused with a required link absent", () => {
    expect(things.parse("object", without(fabric, "representedAs"))).toEqual({
      ...without(fabric, "representedAs"),
      livesIn: ["sheets", "warehouse"],
    });
    expect(things.parse("object", { ...fabric, representedAs: [] })).toEqual({
      ...fabric,
      livesIn: ["sheets", "warehouse"],
      representedAs: [],
    });
    expect(() => things.parse("object", without(fabric, "livesIn"))).toThrow(
      /livesIn/,
    );
  });

  it("is refused with an optional link written with no value (null), which is not an absent key", () => {
    expect(() =>
      things.parse("object", { ...fabric, representedAs: null }),
    ).toThrow(/representedAs/);
  });

  it("parses an optional one link as a name or absent, and refuses null and a list", () => {
    const near = defineType({
      name: "near",
      description: "d",
      fields: { to: oneOrNone(() => source) },
    });
    const pkg = definePackage({
      name: "p",
      description: "d",
      types: { source, near },
    });
    const node = { name: "n", type: "near", description: "d" };
    expect(pkg.parse("near", node)).toEqual(node);
    expect(pkg.parse("near", { ...node, to: "[[sheets]]" })).toEqual({
      ...node,
      to: "sheets",
    });
    for (const to of [null, [], ["[[sheets]]"], "sheets"])
      expect(() => pkg.parse("near", { ...node, to })).toThrow(/to/);
  });

  it("is refused with a field its type does not declare", () => {
    expect(() => things.parse("object", { ...fabric, colour: "blue" })).toThrow(
      /colour/,
    );
  });

  it("is refused with a field of the base or of its type missing", () => {
    expect(() =>
      things.parse("object", without(fabric, "description")),
    ).toThrow(/description/);
    expect(() => things.parse("object", without(fabric, "type"))).toThrow(
      /type/,
    );
    expect(() => things.parse("object", without(fabric, "key"))).toThrow(/key/);
    expect(() => things.parse("object", without(fabric, "name"))).toThrow(
      /name/,
    );
  });

  it("is refused when its type is not the type it is parsed as", () => {
    expect(() => things.parse("object", { ...fabric, type: "source" })).toThrow(
      /type/,
    );
  });

  it("is refused with a list in a one link", () => {
    expect(() =>
      things.parse("external-object", {
        ...attributeValue,
        heldIn: ["[[odoo]]"],
      }),
    ).toThrow(/heldIn/);
  });

  it("is refused with no names in a many link", () => {
    expect(() => things.parse("object", { ...fabric, livesIn: [] })).toThrow(
      /livesIn/,
    );
  });

  it("is refused with a link that is not a wikilink", () => {
    expect(() =>
      things.parse("object", { ...fabric, livesIn: ["sheets"] }),
    ).toThrow(/livesIn/);
    expect(() =>
      things.parse("external-object", { ...attributeValue, heldIn: "odoo" }),
    ).toThrow(/heldIn/);
  });

  it("is refused with a link that starts from another type", () => {
    expect(() =>
      things.parse("source", { ...sheets, livesIn: ["[[odoo]]"] }),
    ).toThrow(/livesIn/);
  });

  it("is refused with a name that is not a slug", () => {
    expect(() => things.parse("source", { ...sheets, name: "Sheets" })).toThrow(
      /name/,
    );
  });

  it("is refused for a type the package does not hold, or a name the object prototype has, by code without types", () => {
    // @ts-expect-error: the compiler refuses verb too; this is the check for code without types.
    expect(() => things.parse("verb", fabric)).toThrow(/verb/);
    // @ts-expect-error: as above.
    expect(() => things.parse("constructor", fabric)).toThrow(/constructor/);
  });
});

// A package of the fixture's types and one more type: the checks run in definePackage.
const withType = (type: Type) =>
  definePackage({
    name: "p",
    description: "d",
    types: {
      object,
      source,
      "external-object": externalObject,
      [type.name]: type,
    },
  });
const plainType = (fields: z.ZodRawShape = {}) =>
  defineType({ name: "t", description: "d", fields });

describe("a package", () => {
  it("is refused with a name that is not a slug, of itself or of a type", () => {
    expect(() =>
      definePackage({ name: "My Things", description: "d", types: {} }),
    ).toThrow();
    const thing = defineType({ name: "Thing", description: "d", fields: {} });
    expect(() =>
      definePackage({ name: "p", description: "d", types: { Thing: thing } }),
    ).toThrow(/Thing/);
  });

  it("is refused with a field, a property or a link, whose name is not a camelCase key", () => {
    for (const field of ["", "Fabric Code", "fabric_code", "FabricCode"]) {
      expect(() => withType(plainType({ [field]: z.string() }))).toThrow(
        /camelCase/,
      );
    }
    expect(() =>
      withType(plainType({ "Lives In": one(() => source) })),
    ).toThrow(/Lives In/);
    expect(() =>
      withType(plainType({ fabricCode2: z.string() })),
    ).not.toThrow();
  });

  it("is refused with a field, a property or a link, that redefines a field of the base, or has a name the object prototype has", () => {
    expect(() => withType(plainType({ description: z.number() }))).toThrow(
      /description/,
    );
    expect(() => withType(plainType({ type: z.string() }))).toThrow(/type/);
    expect(() => withType(plainType({ name: one(() => source) }))).toThrow(
      /name/,
    );
    expect(() =>
      withType(plainType({ constructor: z.string().optional() })),
    ).toThrow(/constructor/);
    expect(() => withType(plainType({ toString: one(() => source) }))).toThrow(
      /toString/,
    );
  });

  it("is refused with a field that holds a link but is not one: a method chained on a link, or a link inside another schema", () => {
    for (const near of [
      many(() => source).optional(),
      one(() => source).optional(),
      one(() => source).describe("The source near it."),
      one(() => source).refine((name) => name !== "odoo"),
      many(() => source).min(2),
      manyOrNone(() => source).nullable(),
      z.array(one(() => source)),
      z.object({ to: one(() => source) }),
      z.lazy(() => one(() => source)),
      z.array(z.lazy(() => many(() => source))),
    ]) {
      expect(() => withType(plainType({ near }))).toThrow(
        /near.*link.*oneOrNone.*manyOrNone/,
      );
    }
    for (const near of [
      oneOrNone(() => source),
      manyOrNone(() => source),
      z.lazy(() => z.string()),
    ])
      expect(() => withType(plainType({ near }))).not.toThrow();
  });

  it("takes a field that refers to itself through a function, and parses its notes", () => {
    const tree = (): z.ZodType =>
      z.object({
        label: z.string(),
        kids: z.array(z.lazy(tree)).optional(),
      });
    const pkg = withType(plainType({ outline: tree() }));
    const node = {
      name: "n",
      type: "t",
      description: "d",
      outline: { label: "a", kids: [{ label: "b" }] },
    };
    expect(pkg.parse("t", node)).toEqual(node);
  });

  it("is refused with a name that is not a slug by a plain Error that names the package, not a ZodError", () => {
    let error: unknown;
    try {
      definePackage({ name: "My Things", description: "d", types: {} });
    } catch (caught) {
      error = caught;
    }
    expect(error).not.toBeInstanceOf(z.ZodError);
    expect(error).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/package My Things.*slug/),
      }),
    );
  });

  it("is refused with a property that is not a zod schema, made without TypeScript", () => {
    expect(() =>
      withType(plainType({ key: "text" } as unknown as z.ZodRawShape)),
    ).toThrow(/key/);
  });

  it("is refused with a type not made by defineType, made without TypeScript", () => {
    expect(() =>
      withType({
        name: "t",
        description: "d",
        schema: z.strictObject({}),
      }),
    ).toThrow(/defineType/);
  });

  it("is refused when a link ends at a type it does not hold, or at another type of the same name", () => {
    expect(() =>
      definePackage({ name: "p", description: "d", types: { object } }),
    ).toThrow(/livesIn.*source/);
    const other = defineType({
      name: "source",
      description: "Another source.",
      fields: { role: z.string() },
    });
    expect(() =>
      definePackage({
        name: "p",
        description: "d",
        types: { object, source: other, "external-object": externalObject },
      }),
    ).toThrow(/livesIn.*source/);
  });

  it("is refused with a type under a key that is not its name, so two types of one name cannot be held, made without TypeScript", () => {
    expect(() =>
      definePackage({
        name: "p",
        description: "d",
        types: { source, other: source } as unknown as {
          source: typeof source;
        },
      }),
    ).toThrow(/other/);
  });

  it("gives the links of a type, and none of its properties", () => {
    expect(
      linksOf(object).map(({ name, to, cardinality, optional }) => ({
        name,
        to: to(),
        cardinality,
        optional,
      })),
    ).toEqual([
      { name: "livesIn", to: source, cardinality: "many", optional: false },
      {
        name: "representedAs",
        to: externalObject,
        cardinality: "many",
        optional: true,
      },
    ]);
    expect(linksOf(source)).toEqual([]);
  });
});

describe("a type", () => {
  const node = { name: "n", type: "t", description: "d", to: "[[sheets]]" };

  it("keeps its fields as they were when it was made, though the caller's fields object changes", () => {
    const fields: Record<string, z.ZodType> = { to: one(() => source) };
    const t = defineType({ name: "t", description: "d", fields });
    fields.to = z.string();
    const pkg = definePackage({
      name: "p",
      description: "d",
      types: { source, t },
    });
    expect(linksOf(t).map((link) => link.name)).toEqual(["to"]);
    expect(pkg.parse("t", node)).toEqual({ ...node, to: "sheets" });
  });

  it("reads a getter in its fields once", () => {
    let reads = 0;
    const t = defineType({
      name: "t",
      description: "d",
      fields: {
        get to() {
          reads += 1;
          return reads === 1 ? one(() => source) : z.string();
        },
      },
    });
    const pkg = definePackage({
      name: "p",
      description: "d",
      types: { source, t },
    });
    expect(linksOf(t).map((link) => link.name)).toEqual(["to"]);
    expect(pkg.parse("t", node)).toEqual({ ...node, to: "sheets" });
    expect(reads).toBe(1);
  });

  it("is frozen", () => {
    const t = defineType({ name: "t", description: "d", fields: {} });
    expect(Object.isFrozen(t)).toBe(true);
  });
});

describe("a package's types", () => {
  it("are frozen when they are checked, so parse goes on with the types that were checked", () => {
    const other = defineType({
      name: "source",
      description: "Another source.",
      fields: { place: z.string() },
    });
    const pkg = definePackage({
      name: "p",
      description: "d",
      types: { source },
    });
    const wide: { source: Type } = pkg.types;
    expect(() => {
      wide.source = other;
    }).toThrow(TypeError);
    const sheets = {
      name: "sheets",
      type: "source",
      description: "d",
      role: "entry",
    };
    expect(pkg.parse("source", sheets)).toEqual(sheets);
    const spread = { ...pkg, types: { ...pkg.types } };
    spread.parse("source", sheets);
    expect(Object.isFrozen(spread.types)).toBe(true);
  });
});

describe("a package spread with other types", () => {
  const sheets = {
    name: "sheets",
    type: "source",
    description: "Where product information is typed.",
  };
  const other = defineType({
    name: "source",
    description: "Another source.",
    fields: { place: z.string() },
  });
  const pkg = definePackage({ name: "p", description: "d", types: { source } });

  it("parses by its own types", () => {
    const spread = { ...pkg, types: { ...pkg.types, source: other } };
    expect(spread.parse("source", { ...sheets, place: "here" })).toEqual({
      ...sheets,
      place: "here",
    });
    expect(() => spread.parse("source", { ...sheets, role: "entry" })).toThrow(
      /role/,
    );
  });

  it("is refused with a type defineType did not make, or a link that ends outside its types", () => {
    const made = {
      ...pkg,
      types: {
        source: {
          name: "source",
          description: "d",
          schema: z.strictObject({}),
        },
      },
    };
    expect(() => made.parse("source", sheets)).toThrow(/defineType/);
    const cut = { ...things, types: { ...things.types, source: other } };
    expect(() => cut.parse("source", { ...sheets, place: "here" })).toThrow(
      /livesIn.*source/,
    );
  });
});
