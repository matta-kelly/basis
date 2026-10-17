import { describe, expect, it } from "vitest";
import * as z from "zod";
import things, { externalObject, object, source } from "../fixtures/things.ts";
import {
  definePackage,
  defineType,
  many,
  manyOrNone,
  one,
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
const plainType = (fields: Type["fields"] = {}) =>
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
      one(() => source).describe("The source near it."),
      one(() => source).refine((name) => name !== "odoo"),
      many(() => source).min(2),
      manyOrNone(() => source).nullable(),
      z.array(one(() => source)),
      z.object({ to: one(() => source) }),
    ]) {
      expect(() => withType(plainType({ near }))).toThrow(
        /near.*link.*manyOrNone/,
      );
    }
    expect(() =>
      withType(plainType({ near: manyOrNone(() => source) })),
    ).not.toThrow();
  });

  it("is refused with a property that is not a zod schema, made without TypeScript", () => {
    expect(() =>
      withType(plainType({ key: "text" } as unknown as Type["fields"])),
    ).toThrow(/key/);
  });

  it("is refused with a type not made by defineType, made without TypeScript", () => {
    expect(() =>
      withType({
        name: "t",
        description: "d",
        fields: {},
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
});
