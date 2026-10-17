// The type a package's parse returns. Each check is made by the type check (tsc); no note is parsed.
import { describe, expectTypeOf, it } from "vitest";
import things, { source } from "../fixtures/things.ts";
import {
  definePackage,
  defineType,
  many,
  linksOf,
  manyOrNone,
  one,
  oneOrNone,
  type Link,
  type Package,
  type Type,
} from "./index.ts";
import * as z from "zod";

// What a call to parse returns, for a package and a type name.
const parserOf =
  <P extends Package, N extends keyof P["types"] & string>(pkg: P, type: N) =>
  (node: unknown) =>
    pkg.parse(type, node);
type Parsed<
  P extends Package,
  N extends keyof P["types"] & string,
> = ReturnType<ReturnType<typeof parserOf<P, N>>>;

type ObjectNote = Parsed<typeof things, "object">;
type ExternalNote = Parsed<typeof things, "external-object">;
type SourceNote = Parsed<typeof things, "source">;

describe("a parsed note's type", () => {
  it("has the base, its type's name, its type's fields, and its links as names", () => {
    expectTypeOf<ObjectNote["name"]>().toEqualTypeOf<string>();
    expectTypeOf<ObjectNote["description"]>().toEqualTypeOf<string>();
    expectTypeOf<ObjectNote["type"]>().toEqualTypeOf<"object">();
    expectTypeOf<ObjectNote["key"]>().toEqualTypeOf<string>();
    expectTypeOf<ObjectNote["states"]>().toEqualTypeOf<string[]>();
    expectTypeOf<ObjectNote["schema"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SourceNote["role"]>().toEqualTypeOf<
      "entry" | "record" | "projection"
    >();
  });

  it("has a one link as a name, a many link as names, and an optional many link as names or nothing", () => {
    expectTypeOf<ExternalNote["heldIn"]>().toEqualTypeOf<string>();
    expectTypeOf<ObjectNote["livesIn"]>().toEqualTypeOf<string[]>();
    expectTypeOf<ObjectNote["representedAs"]>().toEqualTypeOf<
      string[] | undefined
    >();
  });

  it("has an optional one link as a name or nothing", () => {
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
    expectTypeOf(parserOf(pkg, "near"))
      .returns.toHaveProperty("to")
      .toEqualTypeOf<string | undefined>();
  });

  it("has a link only on the type it starts from", () => {
    expectTypeOf<ExternalNote>().not.toHaveProperty("livesIn");
    expectTypeOf<SourceNote>().not.toHaveProperty("heldIn");
  });

  it("is refused by the compiler for a type the package does not have", () => {
    // @ts-expect-error: things has no type verb.
    void (() => things.parse("verb", {}));
  });

  it("has no field but the base for a type with no fields", () => {
    const thing = defineType({ name: "thing", description: "d", fields: {} });
    const pkg = definePackage({
      name: "p",
      description: "d",
      types: { thing },
    });
    type Thing = Parsed<typeof pkg, "thing">;
    expectTypeOf(parserOf(pkg, "thing")).returns.toEqualTypeOf<{
      name: string;
      description: string;
      type: "thing";
    }>();
    // @ts-expect-error: a thing has no field colour.
    expectTypeOf<Thing["colour"]>().toBeUnknown();
  });

  it("is a union of notes for a union of type names", () => {
    const either = (type: "object" | "source", node: unknown) =>
      things.parse(type, node);
    expectTypeOf(either).returns.toEqualTypeOf<ObjectNote | SourceNote>();
    // @ts-expect-error: a source has no livesIn, so the union does not either.
    expectTypeOf<ReturnType<typeof either>["livesIn"]>().toBeUnknown();
  });

  it("is unknown to code that takes any package, and any package is a Package", () => {
    const parseAny = (pkg: Package) => pkg.parse("object", {});
    expectTypeOf(parseAny).returns.toBeUnknown();
    expectTypeOf(things).toExtend<Package>();
  });

  it("holds nothing for a link chosen at run time that may be optional", () => {
    const pick = (optional: boolean) =>
      optional ? manyOrNone(() => source) : many(() => source);
    const near = defineType({
      name: "near",
      description: "d",
      fields: { to: pick(true) },
    });
    const pkg = definePackage({
      name: "p",
      description: "d",
      types: { source, near },
    });
    expectTypeOf(parserOf(pkg, "near"))
      .returns.toHaveProperty("to")
      .toEqualTypeOf<string[] | undefined>();
  });

  it("lets two types link to each other, with the return type of one thunk written", () => {
    // Written, so a's type does not wait on b's: TypeScript refuses a type inferred in a cycle.
    const a = defineType({
      name: "a",
      description: "d",
      fields: { b: one((): Type => b) },
    });
    const b = defineType({
      name: "b",
      description: "d",
      fields: { a: manyOrNone(() => a) },
    });
    const pkg = definePackage({ name: "p", description: "d", types: { a, b } });
    expectTypeOf(parserOf(pkg, "a"))
      .returns.toHaveProperty("b")
      .toEqualTypeOf<string>();
    expectTypeOf(parserOf(pkg, "b"))
      .returns.toHaveProperty("a")
      .toEqualTypeOf<string[] | undefined>();
  });

  it("is refused by the compiler for a package whose key for a type is not the type's name", () => {
    void (() =>
      // @ts-expect-error: the key is other, the type's name is source.
      definePackage({ name: "p", description: "d", types: { other: source } }));
  });

  it("follows the types of the package it is called on, so a spread package parses by its own types", () => {
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
    const spread: Package<{ source: typeof other }> = {
      ...pkg,
      types: { ...pkg.types, source: other },
    };
    expectTypeOf(parserOf(spread, "source")).returns.toEqualTypeOf<{
      name: string;
      description: string;
      type: "source";
      place: string;
    }>();
  });

  it("is refused by the compiler for a parse called apart from its package", () => {
    const { parse } = things;
    // @ts-expect-error: parse reads the package it is called on.
    void (() => parse("object", {}));
  });

  it("gives the links of a type as links", () => {
    expectTypeOf(linksOf).returns.toEqualTypeOf<Link[]>();
    expectTypeOf<Link["to"]>().toEqualTypeOf<() => Type>();
    expectTypeOf<Link["cardinality"]>().toEqualTypeOf<"one" | "many">();
    expectTypeOf<Link["optional"]>().toEqualTypeOf<boolean>();
  });
});
