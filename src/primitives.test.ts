import { describe, expect, it } from "vitest";
import * as z from "zod";
import things, { externalObject, object, source } from "../fixtures/things.ts";
import { defineLink, definePackage, defineType } from "./index.ts";

// The real frontmatter of three notes in ~/cc/ontology, unedited. A node's name is its file name.
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

const without = (node: Record<string, unknown>, field: string) =>
  Object.fromEntries(Object.entries(node).filter(([key]) => key !== field));

const link = (name: string, from = object, to = source) =>
  defineLink({ name, description: "d", from, to, cardinality: "one" });

describe("a node", () => {
  it("parses with the base, its type's properties and its links, and its links come back as names", () => {
    expect(things.parse("object", fabric)).toEqual({
      ...fabric,
      livesIn: ["sheets", "warehouse"],
      representedAs: ["odoo-attribute-value"],
    });
    expect(things.parse("source", sheets)).toEqual(sheets);
    expect(things.parse("external-object", attributeValue)).toEqual({
      ...attributeValue,
      heldIn: "odoo",
    });
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

  it("is refused for a type the package does not hold", () => {
    expect(() => things.parse("verb", fabric)).toThrow(/verb/);
  });
});

describe("a definition", () => {
  it("is refused with a name that is not a slug", () => {
    expect(() =>
      defineType({ name: "Thing", description: "d", properties: {} }),
    ).toThrow();
    expect(() =>
      definePackage({
        name: "My Things",
        description: "d",
        types: [],
        links: [],
      }),
    ).toThrow();
  });

  it("of a type is refused when it redefines a field of the base, and not for a prototype's name", () => {
    expect(() =>
      defineType({
        name: "t",
        description: "d",
        properties: { description: z.number() },
      }),
    ).toThrow(/description/);
    expect(() =>
      defineType({
        name: "t",
        description: "d",
        properties: { type: z.string() },
      }),
    ).toThrow(/type/);
    expect(() =>
      defineType({
        name: "t",
        description: "d",
        properties: { constructor: z.string() },
      }),
    ).not.toThrow();
  });

  it("of a link is refused with the name of a field of the base or of its from type, and not for a prototype's name", () => {
    expect(() => link("description")).toThrow(/description/);
    expect(() => link("key")).toThrow(/key/);
    expect(() => link("toString")).not.toThrow();
  });

  it("of a package is refused when a link ends at a type it does not hold, at either end", () => {
    expect(() =>
      definePackage({
        name: "p",
        description: "d",
        types: [object],
        links: [link("near")],
      }),
    ).toThrow(/source/);
    expect(() =>
      definePackage({
        name: "p",
        description: "d",
        types: [source],
        links: [link("near")],
      }),
    ).toThrow(/object/);
  });

  it("of a package is refused with two types of one name, or two links of one name from one type", () => {
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
        links: [link("near"), link("near", object, externalObject)],
      }),
    ).toThrow(/near/);
  });
});
