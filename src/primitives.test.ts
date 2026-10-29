import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod";
import {
  agent,
  capability,
  company,
  companyCapability,
  core,
} from "../fixtures/layers.ts";
import { typeNotes } from "../fixtures/types.ts";
import things, { externalObject, object, source } from "../fixtures/things.ts";
import {
  basis,
  defineSchema,
  defineType,
  extendType,
  linksOf,
  many,
  manyOrNone,
  node,
  one,
  oneOrNone,
  type,
  type Type,
} from "./index.ts";
import { noteSchemaOf } from "./primitives.ts";

// The frontmatter of four notes of a made-up bakery, as a note would have it, with `name` added
// from the file name, as the loader gives it.
const loaf = {
  name: "loaf",
  type: "object",
  description: "One bake of one dough. A crust.",
  key: "loaf_code",
  livesIn: ["slate", "daybook"],
  schema: "packages/daybook/schema.ts#Loaf",
  states: ["drafted", "complete", "synced", "stale"],
  derived: ["synced", "stale"],
  representedAs: ["till-item"],
};
const slate = {
  name: "slate",
  type: "source",
  description:
    "Where recipes are written: the chalk slate by the door. One line per recipe, loose on purpose.",
  role: "entry",
};
const tillItem = {
  name: "till-item",
  type: "external-object",
  description:
    "A loaf as the till holds it: a line of the menu its recipe picks.",
  heldIn: "till",
  schema: "packages/till/schema.ts#TillItem",
};

const market = {
  name: "market",
  type: "source",
  description:
    "The weekly market stall. A projection; no connector is built yet.",
  role: "projection",
  kind: "marketplace",
};

const without = (node: Record<string, unknown>, field: string) =>
  Object.fromEntries(Object.entries(node).filter(([key]) => key !== field));

describe("a node", () => {
  it("parses with the fields every node has, its type's properties and its links, and its links come back as names", () => {
    expect(things.parse("object", loaf)).toEqual({
      ...loaf,
      livesIn: ["slate", "daybook"],
      representedAs: ["till-item"],
    });
    expect(things.parse("source", slate)).toEqual(slate);
    expect(things.parse("source", market)).toEqual(market);
    expect(things.parse("external-object", tillItem)).toEqual({
      ...tillItem,
      heldIn: "till",
    });
    expect(
      things.parse("external-object", {
        ...tillItem,
        issues: ["a known gap"],
      }),
    ).toMatchObject({ issues: ["a known gap"] });
  });

  it("parses with an optional link absent or empty, and is refused with a required link absent", () => {
    expect(things.parse("object", without(loaf, "representedAs"))).toEqual({
      ...without(loaf, "representedAs"),
      livesIn: ["slate", "daybook"],
    });
    expect(things.parse("object", { ...loaf, representedAs: [] })).toEqual({
      ...loaf,
      livesIn: ["slate", "daybook"],
      representedAs: [],
    });
    expect(() => things.parse("object", without(loaf, "livesIn"))).toThrow(
      /livesIn/,
    );
  });

  it("is refused with an optional link written with no value (null), which is not an absent key", () => {
    expect(() =>
      things.parse("object", { ...loaf, representedAs: null }),
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
      typeNotes,
    });
    const node = { name: "n", type: "near", description: "d" };
    expect(schema.parse("near", node)).toEqual(node);
    expect(schema.parse("near", { ...node, to: "slate" })).toEqual({
      ...node,
      to: "slate",
    });
    for (const to of [null, [], ["slate"], "[[slate]]"])
      expect(() => schema.parse("near", { ...node, to })).toThrow(/to/);
  });

  it("is refused with a field its type does not declare", () => {
    expect(() => things.parse("object", { ...loaf, colour: "blue" })).toThrow(
      /colour/,
    );
  });

  it("is refused with a field every node has, or one of its type, missing", () => {
    expect(() => things.parse("object", without(loaf, "description"))).toThrow(
      /description/,
    );
    expect(() => things.parse("object", without(loaf, "type"))).toThrow(/type/);
    expect(() => things.parse("object", without(loaf, "key"))).toThrow(/key/);
    expect(() => things.parse("object", without(loaf, "name"))).toThrow(/name/);
  });

  it("is refused when its type is not the type it is parsed as", () => {
    expect(() => things.parse("object", { ...loaf, type: "source" })).toThrow(
      /type/,
    );
  });

  it("is refused with a list in a one link", () => {
    expect(() =>
      things.parse("external-object", {
        ...tillItem,
        heldIn: ["till"],
      }),
    ).toThrow(/heldIn/);
  });

  it("is refused with no names in a many link", () => {
    expect(() => things.parse("object", { ...loaf, livesIn: [] })).toThrow(
      /livesIn/,
    );
  });

  it("is refused with a link that is not a name: a wikilink is how a note writes it, not its value", () => {
    expect(() =>
      things.parse("object", { ...loaf, livesIn: ["[[slate]]"] }),
    ).toThrow(/livesIn/);
    for (const heldIn of ["[[till]]", "Till"])
      expect(() =>
        things.parse("external-object", { ...tillItem, heldIn }),
      ).toThrow(/heldIn/);
  });

  it("is refused with a link that starts from another type", () => {
    expect(() =>
      things.parse("source", { ...slate, livesIn: ["till"] }),
    ).toThrow(/livesIn/);
  });

  it("is refused with a name that is not a slug", () => {
    expect(() => things.parse("source", { ...slate, name: "Slate" })).toThrow(
      /name/,
    );
  });

  it("is refused for a type the schema does not hold, or a name the object prototype has, by code without types", () => {
    // @ts-expect-error: the compiler refuses verb too; this is the check for code without types.
    expect(() => things.parse("verb", loaf)).toThrow(/verb/);
    // @ts-expect-error: as above.
    expect(() => things.parse("constructor", loaf)).toThrow(/constructor/);
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
    typeNotes,
  });
const plainType = (fields: z.ZodRawShape = {}) =>
  defineType({ name: "t", description: "d", fields });

describe("a schema", () => {
  it("is refused with a name that is not a slug, of itself or of a type", () => {
    expect(() =>
      defineSchema({
        name: "My Things",
        description: "d",
        types: {},
      }),
    ).toThrow();
    const thing = defineType({ name: "Thing", description: "d", fields: {} });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { Thing: thing },
        typeNotes,
      }),
    ).toThrow(/Thing/);
  });

  it("is refused with a field, a property or a link, whose name is not a camelCase key", () => {
    for (const field of ["", "Loaf Code", "loaf_code", "LoafCode"]) {
      expect(() => withType(plainType({ [field]: z.string() }))).toThrow(
        /camelCase/,
      );
    }
    expect(() =>
      withType(plainType({ "Lives In": one(() => source) })),
    ).toThrow(/Lives In/);
    expect(() => withType(plainType({ loafCode2: z.string() }))).not.toThrow();
  });

  it("is refused with a field, a property or a link, that redefines a field every node has, or has a name the object prototype has", () => {
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
      one(() => source).refine((name) => name !== "till"),
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

  it("is refused by a plain Error when it holds a type of its own and declares no folder of type notes", () => {
    let error: unknown;
    try {
      defineSchema({ name: "p", description: "d", types: { source } });
    } catch (caught) {
      error = caught;
    }
    expect(error).not.toBeInstanceOf(z.ZodError);
    expect(error).toEqual(
      new Error(
        'The schema p holds the type source of its own, and declares no folder of type notes: defineSchema({ ..., typeNotes: new URL("./types/", import.meta.url) }).',
      ),
    );
  });

  it("declares no folder of type notes when it holds no type of its own, or only extensions", () => {
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: {},
        imports: [core],
      }),
    ).not.toThrow();
    expect(company.typeNotes).toBeUndefined();
  });

  it("is refused by a plain Error when it sees another schema that declares its folder of type notes: a folder has one owner", () => {
    const bun = defineType({ name: "bun", description: "d", fields: {} });
    const roll = defineType({ name: "roll", description: "d", fields: {} });
    const folder = new URL("file:///notes/types/");
    const s = defineSchema({
      name: "s",
      description: "d",
      types: { bun },
      typeNotes: folder,
    });
    expect(() =>
      defineSchema({
        name: "s2",
        description: "d",
        types: { roll },
        imports: [s],
        typeNotes: new URL("file:///notes/types"),
      }),
    ).toThrow(
      new Error(
        "The schemas s and s2 both declare /notes/types as the folder of their type notes: a folder has one owner.",
      ),
    );
  });

  it("is refused with a folder of type notes that is not a file URL", () => {
    for (const typeNotes of [
      new URL("https://example.com/types/"),
      "./types/" as unknown as URL,
    ])
      expect(() =>
        defineSchema({
          name: "p",
          description: "d",
          types: { source },
          typeNotes,
        }),
      ).toThrow(
        'The folder of type notes of p is not a file URL: typeNotes: new URL("./types/", import.meta.url).',
      );
  });

  it("is refused with notes that are not a file URL, a skip that is not a function, or sources that are not a list of functions, made without TypeScript", () => {
    const made = (parts: Record<string, unknown>) => () =>
      defineSchema({ name: "p", description: "d", types: {}, ...parts });
    expect(made({ notes: "./notes/" })).toThrow(
      'The folder of notes of p is not a file URL: notes: new URL("./", import.meta.url).',
    );
    expect(made({ skip: ["README.md"] })).toThrow(
      "The skip of p is not a function of a path.",
    );
    expect(made({ sources: [() => ({}), "code"] })).toThrow(
      "The sources of p are not a list of functions.",
    );
  });

  it("is refused with exports that are not a function, or bridges that are not a list of export names, made without TypeScript", () => {
    const made = (parts: Record<string, unknown>) => () =>
      defineSchema({ name: "p", description: "d", types: {}, ...parts });
    expect(made({ exports: { Order: 1 } })).toThrow(
      'The exports of p are not a function that gives them: exports: () => import("./index.ts").',
    );
    expect(made({ bridges: "Card" })).toThrow(
      "The bridges of p are not a list of the names of its exports.",
    );
  });

  it("is refused when two schemas it sees declare one folder of notes", () => {
    const notes = new URL("./notes/", import.meta.url);
    const one = defineSchema({
      name: "one",
      description: "d",
      types: {},
      notes,
    });
    expect(() =>
      defineSchema({
        name: "two",
        description: "d",
        imports: [one],
        types: {},
        notes,
      }),
    ).toThrow(
      `The schemas one and two both declare ${fileURLToPath(notes).replace(/\/$/, "")} as the folder of their notes: a folder has one owner.`,
    );
  });

  // A folder, and a symbolic link to it: two paths of one folder. Removed after each test.
  const made: string[] = [];
  afterEach(() => {
    for (const base of made.splice(0))
      rmSync(base, { recursive: true, force: true });
  });
  const folderAndLink = () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "basis-folders-")));
    made.push(base);
    mkdirSync(join(base, "real"));
    symlinkSync(join(base, "real"), join(base, "link"));
    return {
      real: join(base, "real"),
      byReal: pathToFileURL(`${base}/real/`),
      byLink: pathToFileURL(`${base}/link/`),
    };
  };

  it("is refused when two schemas it sees declare one folder of notes through a symbolic link", () => {
    const { real, byReal, byLink } = folderAndLink();
    const one = defineSchema({
      name: "one",
      description: "d",
      types: {},
      notes: byReal,
    });
    expect(() =>
      defineSchema({
        name: "two",
        description: "d",
        imports: [one],
        types: {},
        notes: byLink,
      }),
    ).toThrow(
      `The schemas one and two both declare ${real} as the folder of their notes: a folder has one owner.`,
    );
  });

  it("is refused when two schemas it sees declare one folder of type notes through a symbolic link", () => {
    const { real, byReal, byLink } = folderAndLink();
    const one = defineSchema({
      name: "one",
      description: "d",
      types: { source },
      typeNotes: byReal,
    });
    expect(() =>
      defineSchema({
        name: "two",
        description: "d",
        imports: [one],
        types: { object, "external-object": externalObject },
        typeNotes: byLink,
      }),
    ).toThrow(
      `The schemas one and two both declare ${real} as the folder of their type notes: a folder has one owner.`,
    );
  });

  it("is refused with a name that is not a slug by a plain Error that names the schema, not a ZodError", () => {
    let error: unknown;
    try {
      defineSchema({
        name: "My Things",
        description: "d",
        types: {},
      });
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
      defineSchema({
        name: "p",
        description: "d",
        types: { object },
        typeNotes,
      }),
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
        typeNotes,
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
        typeNotes,
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
  const node = { name: "n", type: "t", description: "d", to: "slate" };

  it("keeps its fields as they were when it was made, though the caller's fields object changes", () => {
    const fields: Record<string, z.ZodType> = { to: one(() => source) };
    const t = defineType({ name: "t", description: "d", fields });
    fields.to = z.string();
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { source, t },
      typeNotes,
    });
    expect(linksOf(t).map((link) => link.name)).toEqual(["to"]);
    expect(schema.parse("t", node)).toEqual({ ...node, to: "slate" });
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
      typeNotes,
    });
    expect(linksOf(t).map((link) => link.name)).toEqual(["to"]);
    expect(schema.parse("t", node)).toEqual({ ...node, to: "slate" });
    expect(reads).toBe(1);
  });

  it("takes, for each kind of link, as many names as a note takes wikilinks", () => {
    const kinds = { one, oneOrNone, many, manyOrNone };
    const values = [undefined, "slate", [], ["slate"], ["slate", "oven"]];
    const asNote = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(asNote)
        : typeof value === "string"
          ? `[[${value}]]`
          : value;
    for (const [kind, of] of Object.entries(kinds)) {
      const t = defineType({
        name: "t",
        description: "d",
        fields: { to: of(() => source) },
      });
      for (const value of values) {
        const fields = { name: "n", type: "t", description: "d", to: value };
        expect(
          noteSchemaOf(t).safeParse({ ...fields, to: asNote(value) }).success,
          `${kind} of ${JSON.stringify(value)}`,
        ).toBe(t.schema.safeParse(fields).success);
      }
    }
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
      defineSchema({
        name: "p",
        description: "d",
        types: { source, holder },
        typeNotes,
      }),
    ).toThrow(
      "The link a of holder ends at domain, which is not a type of the schema p or its imports.",
    );
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { source, domain, holder },
        typeNotes,
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

  it("is refused with a key field the type does not have, a field every node has among them, made without TypeScript", () => {
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
        /key of t names near, which a node can leave out/,
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
  it("is refused with a field a node can not leave out, made without TypeScript: a node of the type it extends would not fit it", () => {
    for (const [field, schema] of [
      ["stage", z.string()],
      ["heldBy", one(() => agent)],
      ["touches", many(() => agent)],
      ["level", z.number().default(1)],
    ] as const)
      expect(() =>
        extendType(capability, { fields: { [field]: schema } } as never),
      ).toThrow(
        `The extension of capability adds ${field}, which a node must give: each field an extension adds is one a node can leave out (optional, oneOrNone, manyOrNone), so each node of the type it extends fits it.`,
      );
    expect(() =>
      extendType(capability, {
        fields: {
          stage: z.string().optional(),
          heldBy: oneOrNone(() => agent),
          touches: manyOrNone(() => agent),
        },
      }),
    ).not.toThrow();
  });

  const keyedCapability = extendType(capability, {
    fields: { stage: z.string().optional() },
    key: ["title"],
  });
  // A schema made by code without types: the compiler refuses an extension of a type core does not hold.
  const withCapability = (type: Type) =>
    defineSchema({
      name: "p",
      description: "d",
      imports: [core],
      types: { capability: type },
    } as unknown as Parameters<typeof defineSchema>[0]);

  it("can add a key over the extended type's fields, when that type has none", () => {
    expect(keyedCapability.key).toEqual(["title"]);
    expect(capability.key).toEqual([]);
    expect(() => withCapability(keyedCapability)).not.toThrow();
  });

  it("has the key of the type it extends, and is refused with another, made without TypeScript", () => {
    const deeper = extendType(keyedCapability, {
      fields: { budget: z.number().optional() },
    });
    expect(deeper.key).toEqual(["title"]);
    const changed = extendType(keyedCapability, {
      fields: { budget: z.number().optional() },
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
      typeNotes,
    });
    const wide: { source: Type } = schema.types;
    expect(() => {
      wide.source = other;
    }).toThrow(TypeError);
    const slate = {
      name: "slate",
      type: "source",
      description: "d",
      role: "entry",
    };
    expect(schema.parse("source", slate)).toEqual(slate);
    const spread = { ...schema, types: { ...schema.types } };
    spread.parse("source", slate);
    expect(Object.isFrozen(spread.types)).toBe(true);
  });
});

describe("a schema spread with other types", () => {
  const slate = {
    name: "slate",
    type: "source",
    description: "Where recipes are written.",
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
    typeNotes,
  });

  it("parses by its own types", () => {
    const spread = { ...schema, types: { ...schema.types, source: other } };
    expect(spread.parse("source", { ...slate, place: "here" })).toEqual({
      ...slate,
      place: "here",
    });
    expect(() => spread.parse("source", { ...slate, role: "entry" })).toThrow(
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
    expect(() => made.parse("source", slate)).toThrow(/defineType/);
    const cut = { ...things, types: { ...things.types, source: other } };
    expect(() => cut.parse("source", { ...slate, place: "here" })).toThrow(
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
  const shipHere = { ...ship, stage: "live", heldBy: "ana" };
  // A schema made by code without types: the compiler would refuse it.
  const untyped = (schema: unknown) =>
    defineSchema(schema as Parameters<typeof defineSchema>[0]);

  it("holds a type that extends an imported one under its name, parsed with the extended type's fields and its own", () => {
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

  it("is refused with an extension that has a field of the type it extends, made without TypeScript", () => {
    for (const field of ["title", "description", "type"]) {
      const over = extendType(capability, {
        fields: { [field]: z.string().optional() } as Record<string, never>,
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
        typeNotes,
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
        typeNotes,
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
        typeNotes,
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
      typeNotes,
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

  it("is refused with two imports that each extend one type: two owners of one name", () => {
    const studio = defineSchema({
      name: "studio",
      description: "d",
      imports: [core],
      types: {
        capability: extendType(capability, {
          fields: { budget: z.number().optional() },
        }),
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
        typeNotes,
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

describe("an abstract type and the types that inherit it", () => {
  // Two abstract types and a type that inherits both, as PG-Schema writes (dough: grainType & bakedType).
  const grain = defineType({
    name: "grain",
    description: "What is milled.",
    abstract: true,
    fields: { mill: z.string() },
  });
  const baked = defineType({
    name: "baked",
    description: "What comes out of the oven.",
    abstract: true,
    fields: { bakedOn: z.string() },
  });
  const bread = defineType({
    name: "bread",
    description: "A bread.",
    parents: [grain, baked],
    fields: { crust: z.enum(["soft", "hard"]) },
  });
  const bakery = defineSchema({
    name: "bakery",
    description: "d",
    types: { grain, baked, bread },
    typeNotes,
  });
  const rye = {
    name: "rye",
    type: "bread",
    description: "A dark loaf.",
    mill: "north",
    bakedOn: "monday",
    crust: "hard",
  };

  it("parses a node with the fields every node has, each parent's, and its own", () => {
    expect(bakery.parse("bread", rye)).toEqual(rye);
    expect(() => bakery.parse("bread", without(rye, "mill"))).toThrow(/mill/);
    expect(() => bakery.parse("bread", without(rye, "bakedOn"))).toThrow(
      /bakedOn/,
    );
  });

  it("is refused for a node of the abstract type itself", () => {
    expect(() => bakery.parse("grain", { ...rye, type: "grain" })).toThrow(
      /grain is abstract: a node is of a type that inherits it/,
    );
  });

  it("keeps its parents, and node is the abstract parent of every type, unlisted", () => {
    expect(bread.parents).toEqual([grain, baked]);
    expect(grain.abstract).toBe(true);
    expect(bread.abstract).toBe(false);
    expect(node.abstract).toBe(true);
    expect(Object.keys(node.schema.shape)).toEqual([
      "name",
      "type",
      "description",
    ]);
    // Every node's fields first, then each parent's in order, then its own.
    expect(Object.keys(bread.schema.shape)).toEqual([
      "name",
      "type",
      "description",
      "mill",
      "bakedOn",
      "crust",
    ]);
  });

  it("gives the links of its parents as its own", () => {
    const placed = defineType({
      name: "placed",
      description: "d",
      abstract: true,
      fields: { at: one(() => source) },
    });
    const shelf = defineType({
      name: "shelf",
      description: "d",
      parents: [placed],
      fields: {},
    });
    expect(linksOf(shelf).map((link) => link.name)).toEqual(["at"]);
  });

  it("is refused with a field a parent has: extend, never override", () => {
    const over = defineType({
      name: "over",
      description: "d",
      parents: [grain],
      fields: { mill: z.number() },
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { grain, over },
        typeNotes,
      }),
    ).toThrow(/over redefines mill, a field of its parent grain/);
  });

  it("is refused with two parents that give one field differently, and takes one field from a shared parent", () => {
    const wheat = defineType({
      name: "wheat",
      description: "d",
      abstract: true,
      fields: { mill: z.number() },
    });
    const mixed = defineType({
      name: "mixed",
      description: "d",
      parents: [grain, wheat],
      fields: {},
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { grain, wheat, mixed },
        typeNotes,
      }),
    ).toThrow(/mixed inherits mill from grain and from wheat, which differ/);
    const roll = defineType({
      name: "roll",
      description: "d",
      parents: [bread, grain],
      fields: {},
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { grain, baked, bread, roll },
        typeNotes,
      }),
    ).not.toThrow();
  });

  it("is refused when a parent is not a type of the schema or its imports", () => {
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { bread },
        typeNotes,
      }),
    ).toThrow(
      /bread of p inherits grain, which is not a type of the schema p or its imports/,
    );
  });

  it("takes a link to an abstract type", () => {
    const shelf = defineType({
      name: "shelf",
      description: "d",
      fields: { holds: many(() => grain) },
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { grain, baked, bread, shelf },
        typeNotes,
      }),
    ).not.toThrow();
  });

  it("can name inherited fields in its key", () => {
    const milled = defineType({
      name: "milled",
      description: "d",
      parents: [grain],
      fields: {},
      key: ["mill"],
    });
    expect(milled.key).toEqual(["mill"]);
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { grain, milled },
        typeNotes,
      }),
    ).not.toThrow();
  });
});

describe("the built-in type type", () => {
  const typeNote = {
    name: "source",
    type: "type",
    description: "A place data lives.",
  };

  it("has node beside it, which no type lists as a parent and no schema extends", () => {
    const listed = defineType({
      name: "listed",
      description: "d",
      parents: [node],
      fields: {},
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { listed },
        typeNotes,
      }),
    ).toThrow(
      "The type listed lists node as a parent: every type inherits node, unlisted.",
    );
    // As JavaScript can make it: the compiler refuses an extension of node.
    const extended = extendType(
      node as never,
      {
        fields: { owner: z.string().optional() },
      } as never,
    );
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { node: extended } as never,
        typeNotes,
      }),
    ).toThrow(/The type node extends node, which every type inherits/);
    expect(
      node.schema.safeParse({ name: "a", type: "app", description: "d" })
        .success,
    ).toBe(true);
  });

  it("is a type of the built-in schema basis, with node", () => {
    expect(basis.name).toBe("basis");
    expect(basis.imports).toEqual([]);
    expect(basis.types).toEqual({ node, type });
  });

  it("declares basis's types folder as the folder of its type notes", () => {
    expect(basis.typeNotes?.href).toBe(
      new URL("../types/", import.meta.url).href,
    );
  });

  it("parses a type note, and takes abstract only as true or false", () => {
    expect(basis.parse("type", typeNote)).toEqual(typeNote);
    for (const abstract of [true, false])
      expect(basis.parse("type", { ...typeNote, abstract })).toEqual({
        ...typeNote,
        abstract,
      });
    for (const abstract of ["true", null])
      expect(() => basis.parse("type", { ...typeNote, abstract })).toThrow(
        /abstract/,
      );
  });

  it("is seen by a schema that imports nothing: a link can point at it", () => {
    const about = defineType({
      name: "about",
      description: "d",
      fields: { explains: one(() => type) },
    });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { about },
        typeNotes,
      }),
    ).not.toThrow();
  });

  it("refuses the name basis for a schema that is not the built-in one", () => {
    expect(() =>
      defineSchema({ name: "basis", description: "d", types: {} }),
    ).toThrow(/^The schema name basis is basis's own\.$/);
  });

  it("refuses the name basis for an import that is not the built-in schema", () => {
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        imports: [{ ...core, name: "basis" }],
        types: {},
      }),
    ).toThrow(/^The schema name basis is basis's own\.$/);
  });

  it("is refused as the name of a type of another schema: a name has one owner", () => {
    const own = defineType({ name: "type", description: "d", fields: {} });
    expect(() =>
      defineSchema({
        name: "p",
        description: "d",
        types: { type: own },
        typeNotes,
      }),
    ).toThrow(/The type type of p has the name of a type of basis/);
  });
});

describe("a link's own message", () => {
  it("is on the link's record, and absent when the link gives none", () => {
    const message = () => "No such source.";
    const t = defineType({
      name: "t",
      description: "d",
      fields: {
        at: one(() => source, { message }),
        from: manyOrNone(() => source),
      },
    });
    expect(linksOf(t).map((link) => [link.name, link.message])).toEqual([
      ["at", message],
      ["from", undefined],
    ]);
    expect(Object.hasOwn(linksOf(t)[1] ?? {}, "message")).toBe(false);
  });

  it("is a function: a link kind refuses any other message", () => {
    for (const kind of [one, oneOrNone, many, manyOrNone])
      expect(() => kind(() => source, { message: "No." as never })).toThrow(
        "The message of a link is a function of the failure and the graph.",
      );
  });
});
