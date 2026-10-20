import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  agent,
  capability,
  company,
  companyCapability,
  core,
} from "../fixtures/layers.ts";
import things, { externalObject, object, source } from "../fixtures/things.ts";
import {
  definePackage,
  defineSchema,
  defineType,
  extendType,
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
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { source, near },
    });
    const node = { name: "n", type: "near", description: "d" };
    expect(schema.parse("near", node)).toEqual(node);
    expect(schema.parse("near", { ...node, to: "[[sheets]]" })).toEqual({
      ...node,
      to: "sheets",
    });
    for (const to of [null, [], ["[[sheets]]"], "sheets"])
      expect(() => schema.parse("near", { ...node, to })).toThrow(/to/);
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

  it("is refused for a type the schema does not hold, or a name the object prototype has, by code without types", () => {
    // @ts-expect-error: the compiler refuses verb too; this is the check for code without types.
    expect(() => things.parse("verb", fabric)).toThrow(/verb/);
    // @ts-expect-error: as above.
    expect(() => things.parse("constructor", fabric)).toThrow(/constructor/);
  });
});

// A schema of the fixture's types and one more type: the checks run in defineSchema.
const withType = (type: Type) =>
  defineSchema({
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

describe("a schema", () => {
  it("is made by definePackage too, the old name of defineSchema", () => {
    expect(definePackage).toBe(defineSchema);
  });

  it("is refused with a name that is not a slug, of itself or of a type", () => {
    expect(() =>
      defineSchema({ name: "My Things", description: "d", types: {} }),
    ).toThrow();
    const thing = defineType({ name: "Thing", description: "d", fields: {} });
    expect(() =>
      defineSchema({ name: "p", description: "d", types: { Thing: thing } }),
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
    const schema = withType(plainType({ outline: tree() }));
    const node = {
      name: "n",
      type: "t",
      description: "d",
      outline: { label: "a", kids: [{ label: "b" }] },
    };
    expect(schema.parse("t", node)).toEqual(node);
  });

  it("is refused with a name that is not a slug by a plain Error that names the schema, not a ZodError", () => {
    let error: unknown;
    try {
      defineSchema({ name: "My Things", description: "d", types: {} });
    } catch (caught) {
      error = caught;
    }
    expect(error).not.toBeInstanceOf(z.ZodError);
    expect(error).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/schema My Things.*slug/),
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
      defineSchema({ name: "p", description: "d", types: { object } }),
    ).toThrow(/livesIn.*source/);
    const other = defineType({
      name: "source",
      description: "Another source.",
      fields: { role: z.string() },
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { object, source: other, "external-object": externalObject },
      }),
    ).toThrow(/livesIn.*source/);
  });

  it("is refused with a type under a key that is not its name, so two types of one name cannot be held, made without TypeScript", () => {
    expect(() =>
      defineSchema({
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
      { name: "livesIn", to: [source], cardinality: "many", optional: false },
      {
        name: "representedAs",
        to: [externalObject],
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
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { source, t },
    });
    expect(linksOf(t).map((link) => link.name)).toEqual(["to"]);
    expect(schema.parse("t", node)).toEqual({ ...node, to: "sheets" });
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
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { source, t },
    });
    expect(linksOf(t).map((link) => link.name)).toEqual(["to"]);
    expect(schema.parse("t", node)).toEqual({ ...node, to: "sheets" });
    expect(reads).toBe(1);
  });

  it("is frozen", () => {
    const t = defineType({ name: "t", description: "d", fields: {} });
    expect(Object.isFrozen(t)).toBe(true);
  });
});

describe("a link with several targets", () => {
  const domain = defineType({ name: "domain", description: "d", fields: {} });
  const holder = defineType({
    name: "holder",
    description: "d",
    fields: {
      a: one(() => [source, domain]),
      b: oneOrNone(() => [source, domain]),
      c: many(() => [source, domain]),
      d: manyOrNone(() => [source, domain]),
      e: one(() => source),
    },
  });

  it("is made by each link kind, and gives its types as a list, as a link to one type does", () => {
    expect(linksOf(holder).map((link) => [link.name, link.to()])).toEqual([
      ...["a", "b", "c", "d"].map((name) => [name, [source, domain]]),
      ["e", [source]],
    ]);
  });

  it("is refused by a schema that does not hold each of its types", () => {
    expect(() =>
      defineSchema({ name: "p", description: "d", types: { source, holder } }),
    ).toThrow(
      "The link a of holder ends at domain, which is not a type of the schema p or its imports.",
    );
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { source, domain, holder },
      }),
    ).not.toThrow();
  });
});

describe("a type with a key", () => {
  // A key made by code without types: the compiler would refuse it.
  const untypedKey = (key: unknown) => key as never[];
  const keyed = (key: unknown, fields: z.ZodRawShape) =>
    defineType({ name: "t", description: "d", fields, key: untypedKey(key) });

  it("keeps its key as it was when it was made, though the caller's key changes", () => {
    const key = ["title"];
    const t = keyed(key, { title: z.string() });
    key.push("colour");
    expect(t.key).toEqual(["title"]);
    expect(() => withType(t)).not.toThrow();
  });

  it("is refused with a key field the type does not have, a field of the base among them, made without TypeScript", () => {
    expect(() => withType(keyed(["colour"], { title: z.string() }))).toThrow(
      /key of t names colour, which is not a field of t/,
    );
    expect(() => withType(keyed(["name"], {}))).toThrow(
      /key of t names name, which is not a field of t/,
    );
  });

  it("is refused with a key field that can be absent, made without TypeScript", () => {
    for (const field of [
      z.string().optional(),
      oneOrNone(() => source),
      manyOrNone(() => source),
      z.string().exactOptional(),
    ])
      expect(() => withType(keyed(["near"], { near: field }))).toThrow(
        /key of t names near, which a note can leave out/,
      );
    expect(() =>
      withType(keyed(["near"], { near: z.string().default("here") })),
    ).not.toThrow();
  });

  it("is refused with a key field that does not give one string, number or boolean, made without TypeScript", () => {
    for (const field of [
      many(() => source),
      z.record(z.string(), z.string()),
      z.object({ code: z.string() }),
      z.string().transform((code) => new Set([code])),
      z.coerce.bigint(),
      z.string().nullable(),
      z.unknown(),
    ])
      expect(() => withType(keyed(["near"], { near: field }))).toThrow(
        /key of t names near, which does not give one string, number or boolean/,
      );
    for (const field of [
      one(() => source),
      z.number().int(),
      z.boolean(),
      z.enum(["a", "b"]),
      z.literal(["a", 1, true]),
      z.coerce.string(),
      z.union([z.string(), z.number()]),
      z.string().pipe(z.string().min(1)),
      z.string().default("here").readonly(),
    ])
      expect(() => withType(keyed(["near"], { near: field }))).not.toThrow();
  });

  it("is refused with a key that is not a list, or names a field twice, made without TypeScript", () => {
    expect(() => withType(keyed("title", { title: z.string() }))).toThrow(
      /key of t is not a list of field names/,
    );
    expect(() =>
      withType(keyed(["title", "title"], { title: z.string() })),
    ).toThrow(/key of t names title twice/);
  });
});

describe("a type that extends a type", () => {
  const keyedCapability = extendType(capability, {
    fields: { stage: z.string() },
    key: ["title", "stage"],
  });
  // A schema made by code without types: the compiler refuses an extension of a base that core does not hold.
  const withCapability = (type: Type) =>
    defineSchema({
      name: "p",
      description: "d",
      imports: [core],
      types: { capability: type },
    } as unknown as Parameters<typeof defineSchema>[0]);

  it("can add a key over its own fields and its base's, when its base has none", () => {
    expect(keyedCapability.key).toEqual(["title", "stage"]);
    expect(capability.key).toEqual([]);
    expect(() => withCapability(keyedCapability)).not.toThrow();
  });

  it("has the key of its base, and is refused with another, made without TypeScript", () => {
    const deeper = extendType(keyedCapability, {
      fields: { budget: z.number() },
    });
    expect(deeper.key).toEqual(["title", "stage"]);
    const changed = extendType(keyedCapability, {
      fields: { budget: z.number() },
      key: ["budget"] as never,
    });
    expect(() => withCapability(changed)).toThrow(
      /capability changes the key of the type it extends: extend, never override/,
    );
  });
});

describe("a schema's types", () => {
  it("are frozen when they are checked, so parse goes on with the types that were checked", () => {
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
    const wide: { source: Type } = schema.types;
    expect(() => {
      wide.source = other;
    }).toThrow(TypeError);
    const sheets = {
      name: "sheets",
      type: "source",
      description: "d",
      role: "entry",
    };
    expect(schema.parse("source", sheets)).toEqual(sheets);
    const spread = { ...schema, types: { ...schema.types } };
    spread.parse("source", sheets);
    expect(Object.isFrozen(spread.types)).toBe(true);
  });
});

describe("a schema spread with other types", () => {
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
  const schema = defineSchema({
    name: "p",
    description: "d",
    types: { source },
  });

  it("parses by its own types", () => {
    const spread = { ...schema, types: { ...schema.types, source: other } };
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
      ...schema,
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

describe("a schema that imports another", () => {
  const ship = {
    name: "ship",
    type: "capability",
    description: "Ship an order.",
    title: "Ship",
  };
  const shipHere = { ...ship, stage: "live", heldBy: "[[ana]]" };
  // A schema made by code without types: the compiler would refuse it.
  const untyped = (schema: unknown) =>
    defineSchema(schema as Parameters<typeof defineSchema>[0]);

  it("holds a type that extends an imported one under its name, parsed with the base's fields and its own", () => {
    expect(companyCapability.name).toBe("capability");
    expect(companyCapability.description).toBe(capability.description);
    expect(companyCapability.extends).toBe(capability);
    expect(company.imports).toEqual([core]);
    expect(company.parse("capability", shipHere)).toEqual({
      ...shipHere,
      heldBy: "ana",
    });
    expect(() =>
      company.parse("capability", { ...shipHere, title: undefined }),
    ).toThrow(/title/);
  });

  it("leaves the imported schema as it was", () => {
    expect(Object.keys(core.types)).toEqual(["agent", "capability", "case"]);
    expect(core.types.capability).toBe(capability);
    expect(core.imports).toEqual([]);
    expect(core.parse("capability", ship)).toEqual(ship);
    expect(() => core.parse("capability", shipHere)).toThrow(/stage/);
  });

  it("is refused with an extension that has a field of its base, made without TypeScript", () => {
    for (const field of ["title", "description", "type"]) {
      const over = extendType(capability, {
        fields: { [field]: z.string() } as Record<string, never>,
      });
      expect(() =>
        untyped({
          name: "p",
          description: "d",
          imports: [core],
          types: { capability: over },
        }),
      ).toThrow(new RegExp(`capability.*overrides ${field}`));
    }
  });

  it("is refused with a type that extends a type of no schema it imports, made without TypeScript", () => {
    expect(() =>
      untyped({
        name: "p",
        description: "d",
        types: { capability: companyCapability },
      }),
    ).toThrow(
      /capability of p extends capability, which is not a type of the schema p or its imports/,
    );
  });

  it("is refused with a link to a type of neither it nor its imports", () => {
    const stranger = defineType({
      name: "stranger",
      description: "d",
      fields: {},
    });
    const near = defineType({
      name: "near",
      description: "d",
      fields: { to: one(() => stranger), by: one(() => agent) },
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        imports: [core],
        types: { near },
      }),
    ).toThrow(/to of near ends at stranger/);
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        imports: [core],
        types: {
          near: defineType({
            name: "near",
            description: "d",
            fields: { by: one(() => agent) },
          }),
        },
      }),
    ).not.toThrow();
  });

  it("is refused with a type of an imported type's name that does not extend it: one owner per name", () => {
    const other = defineType({ name: "agent", description: "d", fields: {} });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        imports: [core],
        types: { agent: other },
      }),
    ).toThrow(/agent.*core/);
  });

  it("is refused with two imports that give two types of one name, unless one extends the other", () => {
    const elsewhere = defineSchema({
      name: "elsewhere",
      description: "d",
      types: {
        agent: defineType({ name: "agent", description: "d", fields: {} }),
      },
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        imports: [core, elsewhere],
        types: {},
      }),
    ).toThrow(/agent.*core.*elsewhere/);
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        imports: [core, company],
        types: {},
      }),
    ).not.toThrow();
  });

  it("is refused with two imports that each extend one base: two owners of one name", () => {
    const studio = defineSchema({
      name: "studio",
      description: "d",
      imports: [core],
      types: {
        capability: extendType(capability, { fields: { budget: z.number() } }),
      },
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        imports: [company, studio],
        types: {},
      }),
    ).toThrow(
      /two types named capability, from company and from studio, and neither extends the other/,
    );
  });

  it("takes a link to a type of an import's import", () => {
    const task = defineType({
      name: "task",
      description: "d",
      fields: { by: one(() => core.types.agent) },
    });
    expect(() =>
      defineSchema({
        name: "deep",
        description: "d",
        imports: [company],
        types: { task },
      }),
    ).not.toThrow();
  });

  it("is refused with an import whose name is not a slug, naming it", () => {
    expect(() =>
      untyped({
        name: "p",
        description: "d",
        imports: [{ ...core, name: "Not A Slug" }],
        types: {},
      }),
    ).toThrow(/schema Not A Slug is not named by a lowercase slug/);
  });

  it("is refused when it sees two different schemas of one name, and the error names where each one is", () => {
    const studio = defineSchema({
      name: "studio",
      description: "d",
      imports: [{ ...core }],
      types: {},
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        imports: [company, studio],
        types: {},
      }),
    ).toThrow(
      /p sees two schemas named core: at p > company > core, and at p > studio > core/,
    );
    expect(() =>
      untyped({
        name: "core",
        description: "d",
        imports: [company],
        types: {},
      }),
    ).toThrow(/cycle: core imports company imports core/);
  });

  it("is refused with an import that is refused", () => {
    const broken = {
      ...core,
      types: {
        ...core.types,
        agent: { name: "agent", description: "d", schema: z.strictObject({}) },
      },
    };
    expect(() =>
      untyped({ name: "p", description: "d", imports: [broken], types: {} }),
    ).toThrow(/core has agent, which defineType did not make/);
  });

  it("is refused with a cycle of imports, found by schema name", () => {
    const looped = { ...core, imports: [company] };
    expect(() =>
      looped.parse("agent", {
        name: "ana",
        type: "agent",
        description: "d",
        role: "r",
      }),
    ).toThrow(/cycle: core imports company imports core/);
    expect(() =>
      untyped({
        name: "company",
        description: "d",
        imports: [company],
        types: {},
      }),
    ).toThrow(/cycle: company imports company/);
  });
});
