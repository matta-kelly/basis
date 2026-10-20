// The type a schema's parse returns. Each check is made by the type check (tsc); no note is parsed.
import { describe, expectTypeOf, it } from "vitest";
import {
  agent,
  capability,
  company,
  companyCapability,
  core,
} from "../fixtures/layers.ts";
import things, { source } from "../fixtures/things.ts";
import {
  defineSchema,
  defineType,
  extendType,
  many,
  linksOf,
  manyOrNone,
  one,
  oneOrNone,
  type Link,
  type Schema,
  type Type,
} from "./index.ts";
import * as z from "zod";

// What a call to parse returns, for a schema and a type name.
const parserOf =
  <P extends Schema, N extends keyof P["types"] & string>(schema: P, type: N) =>
  (node: unknown) =>
    schema.parse(type, node);
type Parsed<P extends Schema, N extends keyof P["types"] & string> = ReturnType<
  ReturnType<typeof parserOf<P, N>>
>;

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
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { source, near },
    });
    expectTypeOf(parserOf(schema, "near"))
      .returns.toHaveProperty("to")
      .toEqualTypeOf<string | undefined>();
  });

  it("has a link only on the type it starts from", () => {
    expectTypeOf<ExternalNote>().not.toHaveProperty("livesIn");
    expectTypeOf<SourceNote>().not.toHaveProperty("heldIn");
  });

  it("is refused by the compiler for a type the schema does not have", () => {
    // @ts-expect-error: things has no type verb.
    void (() => things.parse("verb", {}));
  });

  it("has no field but the base for a type with no fields", () => {
    const thing = defineType({ name: "thing", description: "d", fields: {} });
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { thing },
    });
    type Thing = Parsed<typeof schema, "thing">;
    expectTypeOf(parserOf(schema, "thing")).returns.toEqualTypeOf<{
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

  it("is a record of unknown fields to code that takes any schema, and any schema is a Schema", () => {
    const parseAny = (schema: Schema) => schema.parse("object", {});
    expectTypeOf(parseAny).returns.toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf(things).toExtend<Schema>();
  });

  it("holds nothing for a link chosen at run time that may be optional", () => {
    const pick = (optional: boolean) =>
      optional ? manyOrNone(() => source) : many(() => source);
    const near = defineType({
      name: "near",
      description: "d",
      fields: { to: pick(true) },
    });
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { source, near },
    });
    expectTypeOf(parserOf(schema, "near"))
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
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { a, b },
    });
    expectTypeOf(parserOf(schema, "a"))
      .returns.toHaveProperty("b")
      .toEqualTypeOf<string>();
    expectTypeOf(parserOf(schema, "b"))
      .returns.toHaveProperty("a")
      .toEqualTypeOf<string[] | undefined>();
  });

  it("is refused by the compiler for a schema whose key for a type is not the type's name", () => {
    void (() =>
      // @ts-expect-error: the key is other, the type's name is source.
      defineSchema({ name: "p", description: "d", types: { other: source } }));
  });

  it("follows the types of the schema it is called on, so a spread schema parses by its own types", () => {
    const other = defineType({
      name: "source",
      description: "Another source.",
      fields: { place: z.string() },
    });
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { source },
    });
    const spread: Schema<{ source: typeof other }> = {
      ...schema,
      types: { ...schema.types, source: other },
    };
    expectTypeOf(parserOf(spread, "source")).returns.toEqualTypeOf<{
      name: string;
      description: string;
      type: "source";
      place: string;
    }>();
  });

  it("is refused by the compiler for a parse called apart from its schema", () => {
    const { parse } = things;
    // @ts-expect-error: parse reads the schema it is called on.
    void (() => parse("object", {}));
  });

  it("has one description of a type's fields: its schema", () => {
    expectTypeOf<Type>().not.toHaveProperty("fields");
    expectTypeOf<Type["schema"]>().toHaveProperty("shape");
  });

  it("gives the links of a type as links", () => {
    expectTypeOf(linksOf).returns.toEqualTypeOf<Link[]>();
    expectTypeOf<Link["to"]>().toEqualTypeOf<() => readonly Type[]>();
    expectTypeOf<Link["cardinality"]>().toEqualTypeOf<"one" | "many">();
    expectTypeOf<Link["optional"]>().toEqualTypeOf<boolean>();
  });

  it("is refused by the compiler for a link to an empty list of types", () => {
    // @ts-expect-error: a link points at one type or more.
    void one(() => []);
    void one(() => [source]);
  });
});

describe("a type that extends another, in a schema that imports it", () => {
  it("parses with the base's fields and its own, under the base's name", () => {
    expectTypeOf(parserOf(company, "capability")).returns.toEqualTypeOf<{
      name: string;
      description: string;
      type: "capability";
      title: string;
      stage: "idea" | "live";
      heldBy: string;
    }>();
    expectTypeOf(companyCapability.name).toEqualTypeOf<"capability">();
    expectTypeOf(companyCapability.extends).toEqualTypeOf(capability);
  });

  it("leaves the base and the imported schema as they were", () => {
    expectTypeOf(parserOf(core, "capability")).returns.toEqualTypeOf<{
      name: string;
      description: string;
      type: "capability";
      title: string;
    }>();
  });

  it("is refused by the compiler with a field the base has, its own or of the base of every node", () => {
    void (() =>
      // @ts-expect-error: capability has title (the field's type is never).
      extendType(capability, { fields: { title: z.number() } }));
    void (() =>
      // @ts-expect-error: every node has description (the field's type is never).
      extendType(capability, { fields: { description: z.string() } }));
  });

  it("is refused by the compiler in a schema that does not import its base", () => {
    void (() =>
      defineSchema({
        name: "p",
        description: "d",
        // @ts-expect-error: no schema of p's imports holds the capability companyCapability extends.
        types: { capability: companyCapability },
      }));
    const other = defineSchema({
      name: "other",
      description: "d",
      types: { agent },
    });
    void (() =>
      defineSchema({
        name: "p",
        description: "d",
        imports: [other],
        // @ts-expect-error: as above; other holds no capability.
        types: { capability: companyCapability },
      }));
  });

  it("follows imports past the first level: a type extends a type of an import's import", () => {
    const deep = defineSchema({
      name: "deep",
      description: "d",
      imports: [company],
      types: {
        agent: extendType(core.types.agent, { fields: { level: z.number() } }),
      },
    });
    expectTypeOf(parserOf(deep, "agent"))
      .returns.toHaveProperty("level")
      .toEqualTypeOf<number>();
  });

  it("is refused by the compiler for an imported type: parse takes the schema's own types", () => {
    // @ts-expect-error: agent is core's; a note of it is parsed by core.
    void (() => company.parse("agent", {}));
  });

  it("cannot make a direct cycle: the compiler refuses a schema used before it is defined", () => {
    void (() => {
      // @ts-expect-error: a's type waits on b's.
      const a = defineSchema({
        name: "a",
        description: "d",
        // @ts-expect-error: b is used before it is defined.
        imports: [b],
        types: {},
      });
      // @ts-expect-error: b's type waits on a's.
      const b = defineSchema({
        name: "b",
        description: "d",
        imports: [a],
        types: {},
      });
      return b;
    });
  });
});

describe("a type's key", () => {
  it("is refused by the compiler with a field the type does not have, a field of the base, or a field a note can leave out", () => {
    void (() =>
      defineType({
        name: "t",
        description: "d",
        fields: {
          title: z.string(),
          note: z.string().optional(),
          exact: z.string().exactOptional(),
        },
        key: [
          "title",
          // @ts-expect-error: t has no field colour.
          "colour",
          // @ts-expect-error: name is a field of the base, not of t.
          "name",
          // @ts-expect-error: a note of t can leave note out.
          "note",
          // @ts-expect-error: a note of t can leave exact out, though it cannot write it as undefined.
          "exact",
        ],
      }));
  });

  it("takes a field that gives one string, number or boolean, a one link among them, and is refused by the compiler with any other", () => {
    const t = defineType({
      name: "t",
      description: "d",
      fields: {
        to: one(() => source),
        code: z.string(),
        count: z.number(),
        live: z.boolean(),
        sources: many(() => source),
        labels: z.record(z.string(), z.string()),
        codes: z.string().transform((code) => new Set([code])),
        big: z.coerce.bigint(),
        maybe: z.string().nullable(),
      },
      key: [
        "to",
        "code",
        "count",
        "live",
        // @ts-expect-error: a many link gives a list of names.
        "sources",
        // @ts-expect-error: a record is not one value.
        "labels",
        // @ts-expect-error: a transform to a Set.
        "codes",
        // @ts-expect-error: a bigint.
        "big",
        // @ts-expect-error: null is not a string.
        "maybe",
      ],
    });
    void t;
  });

  it("takes, on an extension, its own fields and its base's, and is refused by the compiler when its base has a key", () => {
    const keyed = extendType(capability, {
      fields: { stage: z.string() },
      key: ["title", "stage"],
    });
    void (() =>
      extendType(capability, {
        fields: { stage: z.string(), budget: z.number().optional() },
        key: [
          // @ts-expect-error: a note can leave budget out.
          "budget",
          // @ts-expect-error: description is a field of the base of every node.
          "description",
        ],
      }));
    void (() =>
      extendType(keyed, {
        fields: { level: z.number() },
        // @ts-expect-error: keyed has a key: extend, never override.
        key: ["level"],
      }));
  });

  it("adds no second description of a type: the key names fields of its schema", () => {
    expectTypeOf<Type>().not.toHaveProperty("fields");
    expectTypeOf<NonNullable<Type["key"]>>().toEqualTypeOf<readonly string[]>();
  });
});
