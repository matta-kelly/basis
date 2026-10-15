import { describe, expect, it } from "vitest";
import * as z from "zod";
import things, { object, source } from "../fixtures/things.ts";
import { defineLink, definePackage, defineType } from "./index.ts";

// The frontmatter of fabric.md, with its name from the file name.
const fabric = { name: "fabric", description: "One print on one cloth.", key: "fabric_code", livesIn: ["[[sheets]]", "[[warehouse]]"] };

describe("a package", () => {
  it("parses a node of its type, with the link as the names it points at", () => {
    expect(things.parse("object", fabric)).toEqual({ ...fabric, livesIn: ["sheets", "warehouse"] });
  });

  it("refuses a node that misses a field, of the base or of its type", () => {
    const { description: _d, ...noDescription } = fabric;
    const { key: _k, ...noKey } = fabric;
    expect(() => things.parse("object", noDescription)).toThrow(/description/);
    expect(() => things.parse("object", noKey)).toThrow(/key/);
  });

  it("refuses a field its type does not declare: the world is closed", () => {
    expect(() => things.parse("object", { ...fabric, colour: "blue" })).toThrow(/colour/);
  });

  it("refuses a link that is not a wikilink", () => {
    expect(() => things.parse("object", { ...fabric, livesIn: ["sheets"] })).toThrow(/livesIn/);
  });

  it("refuses a type it does not hold", () => {
    expect(() => things.parse("verb", fabric)).toThrow(/verb/);
  });
});

describe("the definitions", () => {
  it("refuse a type that redefines a field of the base", () => {
    expect(() => defineType({ name: "t", description: "d", properties: { description: z.number() } })).toThrow(/description/);
  });

  it("refuse a link whose name is a property of the type it starts from", () => {
    expect(() => defineLink({ name: "key", description: "d", from: object, to: source, cardinality: "one" })).toThrow(/key/);
  });

  it("refuse a package whose link ends at a type it does not hold", () => {
    const link = defineLink({ name: "near", description: "d", from: object, to: source, cardinality: "one" });
    expect(() => definePackage({ name: "p", description: "d", types: [object], links: [link] })).toThrow(/source/);
  });

  it("refuse a package with two types of one name", () => {
    expect(() => definePackage({ name: "p", description: "d", types: [source, source], links: [] })).toThrow(/source/);
  });
});
