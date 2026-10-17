import { describe, expect, it } from "vitest";
import * as z from "zod";
import things, { externalObject, object, source } from "../fixtures/things.ts";
import {
  defineLink,
  definePackage,
  defineType,
  type Link,
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

  it("parses with an optional link absent, and is refused with a required link absent", () => {
    expect(things.parse("object", without(fabric, "representedAs"))).toEqual({
      ...without(fabric, "representedAs"),
      livesIn: ["sheets", "warehouse"],
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

  it("is refused with no names in a required many link, and takes none in an optional one", () => {
    expect(() => things.parse("object", { ...fabric, livesIn: [] })).toThrow(
      /livesIn/,
    );
    expect(
      things.parse("object", { ...fabric, representedAs: [] }),
    ).toMatchObject({ representedAs: [] });
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

  it("is refused for a type the package does not hold", () => {
    // @ts-expect-error: the compiler refuses it too; this checks the refusal at run time, for code without types.
    expect(() => things.parse("verb", fabric)).toThrow(/verb/);
  });
});

// A package of one type, or of the fixture's types and one link: the checks run in definePackage.
const withType = (type: Type) =>
  definePackage({ name: "p", description: "d", types: [type], links: [] });
const withLink = (link: Link) =>
  definePackage({
    name: "p",
    description: "d",
    types: [object, source, externalObject],
    links: [link],
  });
const plainType = (
  name: string,
  properties: Type["properties"] = {},
): Type => ({ name, description: "d", properties });
const plainLink = (
  name: string,
  from: Type = object,
  to: Type = source,
): Link => ({
  name,
  description: "d",
  from,
  to,
  cardinality: "one",
});

describe("a package", () => {
  it("is refused with a name that is not a slug, of itself or of a type", () => {
    expect(() =>
      definePackage({
        name: "My Things",
        description: "d",
        types: [],
        links: [],
      }),
    ).toThrow();
    expect(() => withType(plainType("Thing"))).toThrow(/Thing/);
  });

  it("is refused with a link whose name is not a camelCase key", () => {
    expect(() => withLink(plainLink(""))).toThrow();
    expect(() => withLink(plainLink("Lives In"))).toThrow(/Lives In/);
    expect(() => withLink(plainLink("LivesIn"))).toThrow(/LivesIn/);
    expect(() => withLink(plainLink("livesIn2"))).not.toThrow();
  });

  it("is refused with a type that redefines a field of the base, made with defineType or not, or has a prototype's name", () => {
    expect(() =>
      withType(
        defineType({
          name: "t",
          description: "d",
          properties: { description: z.number() },
        }),
      ),
    ).toThrow(/description/);
    expect(() => withType(plainType("t", { type: z.string() }))).toThrow(
      /type/,
    );
    expect(() =>
      withType(plainType("t", { constructor: z.string().optional() })),
    ).toThrow(/constructor/);
  });

  it("is refused with a property whose name is not a camelCase key", () => {
    expect(() =>
      withType(plainType("t", { "Fabric Code": z.string() })),
    ).toThrow(/Fabric Code/);
    expect(() => withType(plainType("t", { fabric_code: z.string() }))).toThrow(
      /fabric_code/,
    );
    expect(() => withType(plainType("t", { FabricCode: z.string() }))).toThrow(
      /FabricCode/,
    );
    expect(() =>
      withType(plainType("t", { fabricCode: z.string() })),
    ).not.toThrow();
  });

  it("is refused with a property that is not a zod schema, made without TypeScript", () => {
    expect(() =>
      withType(
        plainType("t", { key: "text" } as unknown as Type["properties"]),
      ),
    ).toThrow(/key/);
  });

  it("is refused with a link named as a field of the base or of its from type, made with defineLink or not, or as a prototype's name", () => {
    expect(() => withLink(defineLink(plainLink("description")))).toThrow(
      /description/,
    );
    expect(() => withLink(plainLink("key"))).toThrow(/key/);
    expect(() => withLink(plainLink("toString"))).toThrow(/toString/);
  });

  it("is refused with a link whose cardinality is not one or many, or whose required is not true or false, made without TypeScript", () => {
    expect(() =>
      withLink({ ...plainLink("near"), cardinality: "One" } as unknown as Link),
    ).toThrow(/One/);
    expect(() =>
      withLink({ ...plainLink("near"), required: "no" } as unknown as Link),
    ).toThrow(/required/);
  });

  it("is refused when a link ends at a type it does not hold, at either end", () => {
    expect(() =>
      definePackage({
        name: "p",
        description: "d",
        types: [object],
        links: [plainLink("near")],
      }),
    ).toThrow(/source/);
    expect(() =>
      definePackage({
        name: "p",
        description: "d",
        types: [source],
        links: [plainLink("near")],
      }),
    ).toThrow(/object/);
  });

  it("is refused with two types of one name, or two links of one name from one type", () => {
    expect(() =>
      definePackage({
        name: "p",
        description: "d",
        types: [source, source],
        links: [],
      }),
    ).toThrow(/source/);
    expect(() =>
      definePackage({
        name: "p",
        description: "d",
        types: [object, source, externalObject],
        links: [plainLink("near"), plainLink("near", object, externalObject)],
      }),
    ).toThrow(/near/);
  });
});
