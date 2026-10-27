import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod";
import kitchen from "../fixtures/kitchen.ts";
import { company, core } from "../fixtures/layers.ts";
import { typeNotes } from "../fixtures/types.ts";
import things from "../fixtures/things.ts";
import {
  basis,
  defineRule,
  defineSchema,
  defineType,
  extendType,
  lint,
  lintFolder,
  many,
  manyOrNone,
  node,
  one,
  oneOrNone,
  type,
  type Graph,
  type LinkFailure,
  type Piece,
  type Note,
  type Source,
} from "./index.ts";

const note = (path: string, fields: Record<string, unknown>): Note => ({
  path,
  name: basename(path, ".md"),
  fields,
  body: "",
});

const slate = note("slate.md", {
  type: "source",
  description: "Where recipes are written.",
  role: "entry",
});
const till = note("till.md", {
  type: "source",
  description: "The shop's till.",
  role: "projection",
});
const loaf = note("loaf.md", {
  type: "object",
  description: "One bake of one dough.",
  key: "loaf_code",
  livesIn: ["[[slate]]"],
  states: ["drafted", "complete"],
  representedAs: ["[[till-item]]"],
});
const tillItem = note("till-item.md", {
  type: "external-object",
  description: "A loaf as the till holds it.",
  heldIn: "[[till]]",
});
const right = [slate, till, loaf, tillItem];

// The notes that are right, with one note changed.
const withNote = (changed: Note) => [
  ...right.filter((n) => n.path !== changed.path),
  changed,
];
const edit = (n: Note, fields: Record<string, unknown>): Note => ({
  ...n,
  fields,
});
const without = (n: Note, field: string) =>
  edit(
    n,
    Object.fromEntries(
      Object.entries(n.fields).filter(([key]) => key !== field),
    ),
  );

describe("the lint", () => {
  it("gives no problems for the notes that are right", () => {
    expect(lint(things, right)).toEqual([]);
  });

  it("gives a problem for each field a note's type does not declare, and each one it is missing", () => {
    const problems = lint(
      things,
      withNote(
        edit(without(loaf, "key"), {
          ...without(loaf, "key").fields,
          colour: "blue",
          size: "large",
        }),
      ),
    );
    expect(problems).toHaveLength(3);
    expect(problems.every((p) => p.path === "loaf.md")).toBe(true);
    for (const field of ["key", "colour", "size"]) {
      expect(problems.some((p) => p.field === `/${field}`)).toBe(true);
    }
  });

  it("gives a problem for a note whose type the schema does not have, or is a name the object prototype has, or with no type", () => {
    expect(
      lint(things, withNote(edit(slate, { ...slate.fields, type: "verb" }))),
    ).toEqual([
      {
        path: "slate.md",
        rule: "basis/type",
        field: "/type",
        message: expect.stringMatching(/verb/),
      },
    ]);
    expect(
      lint(
        things,
        withNote(edit(slate, { ...slate.fields, type: "constructor" })),
      ),
    ).toEqual([
      {
        path: "slate.md",
        rule: "basis/type",
        field: "/type",
        message: expect.stringMatching(/constructor/),
      },
    ]);
    expect(lint(things, withNote(without(slate, "type")))).toEqual([
      {
        path: "slate.md",
        rule: "basis/type",
        field: "/type",
        message: expect.stringMatching(/no type/),
      },
    ]);
    expect(
      lint(things, withNote(edit(slate, { ...slate.fields, type: null }))),
    ).toEqual([
      {
        path: "slate.md",
        rule: "basis/type",
        field: "/type",
        message: expect.stringMatching(/no type/),
      },
    ]);
    expect(
      lint(things, withNote(edit(slate, { ...slate.fields, type: 5 }))),
    ).toEqual([
      {
        path: "slate.md",
        rule: "basis/type",
        field: "/type",
        message: expect.stringMatching(/5 is not a name/),
      },
    ]);
    expect(
      lint(things, withNote(edit(slate, { ...slate.fields, type: "" }))),
    ).toEqual([
      {
        path: "slate.md",
        rule: "basis/type",
        field: "/type",
        message: expect.stringMatching(/no type/),
      },
    ]);
    const loop: unknown[] = [];
    loop.push(loop);
    expect(
      lint(things, withNote(edit(slate, { ...slate.fields, type: loop }))),
    ).toEqual([
      {
        path: "slate.md",
        rule: "basis/type",
        field: "/type",
        message: expect.stringMatching(/is not a name/),
      },
    ]);
    expect(
      lint(
        things,
        withNote(edit(slate, { ...slate.fields, type: ["source"] })),
      ),
    ).toEqual([
      {
        path: "slate.md",
        rule: "basis/type",
        field: "/type",
        message: expect.stringMatching(/source.* is not a name/),
      },
    ]);
  });

  it("checks the links of a note that fails the zod schema of its type", () => {
    const problems = lint(
      things,
      withNote(
        edit(without(loaf, "key"), {
          ...without(loaf, "key").fields,
          livesIn: ["[[nowhere]]"],
        }),
      ),
    );
    expect(problems.map((p) => [p.rule, p.field])).toEqual([
      ["basis/fields", "/key"],
      ["basis/link", "/livesIn"],
    ]);
  });

  it("checks a link against a read note when an unread note has the same name, and reports the read one as a duplicate", () => {
    const oven = note("b/oven.md", {
      type: "external-object",
      description: "Read, and of the wrong type for livesIn.",
      heldIn: "[[till]]",
    });
    const linking = edit(loaf, {
      ...loaf.fields,
      livesIn: ["[[slate]]", "[[oven]]"],
    });
    expect(
      lint(
        things,
        [...withNote(linking), oven],
        [{ path: "a/oven.md", name: "oven", note: true }],
      ),
    ).toEqual([
      {
        path: "b/oven.md",
        rule: "basis/unique-name",
        message: expect.stringContaining("a/oven.md"),
      },
      {
        path: "loaf.md",
        rule: "basis/link",
        field: "/livesIn",
        message: expect.stringMatching(/oven.*source/),
      },
    ]);
  });

  it("gives a problem for a link to a note that does not exist", () => {
    expect(
      lint(
        things,
        withNote(edit(loaf, { ...loaf.fields, livesIn: ["[[nowhere]]"] })),
      ),
    ).toEqual([
      {
        path: "loaf.md",
        rule: "basis/link",
        field: "/livesIn",
        message: expect.stringMatching(/nowhere/),
      },
    ]);
  });

  it("gives a problem for a link to a note of the wrong type", () => {
    expect(
      lint(
        things,
        withNote(
          edit(loaf, {
            ...loaf.fields,
            representedAs: ["[[slate]]"],
          }),
        ),
      ),
    ).toEqual([
      {
        path: "loaf.md",
        rule: "basis/link",
        field: "/representedAs",
        message: expect.stringMatching(/slate.*external-object/),
      },
    ]);
  });

  it("gives no problem for a link to a note that has its own problems", () => {
    const problems = lint(things, withNote(without(tillItem, "description")));
    expect(problems.map((p) => p.path)).toEqual(["till-item.md"]);
  });

  it("gives a problem for each of two notes with one name, naming the other", () => {
    const twin = { ...slate, path: "copies/slate.md" };
    expect(lint(things, [...right, twin])).toEqual([
      {
        path: "copies/slate.md",
        rule: "basis/unique-name",
        message: expect.stringContaining("slate.md"),
      },
      {
        path: "slate.md",
        rule: "basis/unique-name",
        message: expect.stringContaining("copies/slate.md"),
      },
    ]);
  });

  it("gives a problem for a note whose file name is not a slug, naming the file name", () => {
    expect(
      lint(things, [
        ...right,
        { ...till, path: "Bad_Name.md", name: "Bad_Name" },
      ]),
    ).toEqual([
      {
        path: "Bad_Name.md",
        rule: "basis/name",
        message: expect.stringMatching(/name Bad_Name is not a lowercase slug/),
      },
    ]);
  });

  it("gives a problem for a note that writes its own name", () => {
    expect(
      lint(things, withNote(edit(slate, { ...slate.fields, name: "slate" }))),
    ).toEqual([
      {
        path: "slate.md",
        rule: "basis/name",
        field: "/name",
        message: expect.stringMatching(/name/),
      },
    ]);
  });
});

describe("the lint of a schema whose name is not a slug", () => {
  it("throws once, and gives no field problem to each note", () => {
    const named = { ...things, name: "My Things" };
    expect(() => lint(named, right)).toThrow(/schema My Things/);
  });
});

describe("the lint of a schema that imports another", () => {
  const ana = note("ana.md", {
    type: "agent",
    description: "The agent that ships.",
    role: "shipper",
  });
  const ship = note("ship.md", {
    type: "capability",
    description: "Ship an order.",
    title: "Ship",
    stage: "live",
    heldBy: "[[ana]]",
  });
  const shipWorks = note("ship-works.md", {
    type: "case",
    description: "An order ships.",
    capability: "[[ship]]",
  });
  const layered = [ana, ship, shipWorks];
  const changed = (n: Note, fields: Record<string, unknown>) => [
    ...layered.filter((m) => m.path !== n.path),
    edit(n, { ...n.fields, ...fields }),
  ];

  it("gives no problems for notes of both schemas that are right", () => {
    expect(lint(company, layered)).toEqual([]);
  });

  it("resolves a link to an imported type that the schema extends", () => {
    const reviews = defineSchema({
      name: "reviews",
      description: "d",
      imports: [core],
      types: {
        capability: extendType(core.types.capability, {
          fields: { stage: z.string(), heldBy: one(() => core.types.agent) },
        }),
        review: defineType({
          name: "review",
          description: "d",
          fields: { of: one(() => core.types.capability) },
        }),
      },
      typeNotes,
    });
    const review = note("ship-review.md", {
      type: "review",
      description: "How shipping went.",
      of: "[[ship]]",
    });
    expect(lint(reviews, [...layered, review])).toEqual([]);
    expect(
      lint(reviews, [
        ...layered,
        edit(review, { ...review.fields, of: "[[ana]]" }),
      ]),
    ).toEqual([
      {
        path: "ship-review.md",
        rule: "basis/link",
        field: "/of",
        message: expect.stringMatching(
          /ana, which is a agent, not a capability/,
        ),
      },
    ]);
  });

  it("checks its schema once at the start, though every note is of an imported type", () => {
    const broken = {
      ...company,
      types: {
        ...company.types,
        odd: { name: "odd", description: "d", schema: z.strictObject({}) },
      },
    };
    expect(() => lint(broken, [ana])).toThrow(
      /company has odd, which defineType did not make/,
    );
  });

  it("parses a note of an extended type by the extension, and a note of an imported type by its own", () => {
    expect(lint(company, changed(ship, { stage: undefined }))).toEqual([
      {
        path: "ship.md",
        rule: "basis/fields",
        field: "/stage",
        message: expect.stringMatching(/^Missing: /),
      },
    ]);
    expect(lint(company, changed(ana, { role: undefined }))).toEqual([
      {
        path: "ana.md",
        rule: "basis/fields",
        field: "/role",
        message: expect.stringMatching(/^Missing: /),
      },
    ]);
    // By core alone, a company capability has fields core does not know.
    expect(lint(core, layered).map((p) => [p.rule, p.field])).toEqual([
      ["basis/fields", "/stage"],
      ["basis/fields", "/heldBy"],
    ]);
  });

  it("gives a problem for a link to no note, and to a note of the wrong type, across the two schemas", () => {
    expect(lint(company, changed(ship, { heldBy: "[[nobody]]" }))).toEqual([
      {
        path: "ship.md",
        rule: "basis/link",
        field: "/heldBy",
        message: expect.stringMatching(
          /It points at nobody, which is not a node/,
        ),
      },
    ]);
    expect(lint(company, changed(ship, { heldBy: "[[ship-works]]" }))).toEqual([
      {
        path: "ship.md",
        rule: "basis/link",
        field: "/heldBy",
        message: expect.stringMatching(
          /ship-works, which is a case, not a agent/,
        ),
      },
    ]);
    expect(
      lint(company, changed(shipWorks, { capability: "[[ana]]" })),
    ).toEqual([
      {
        path: "ship-works.md",
        rule: "basis/link",
        field: "/capability",
        message: expect.stringMatching(
          /ana, which is a agent, not a capability/,
        ),
      },
    ]);
  });

  it("gives a problem for a note of a type of neither the schema nor its imports, and none to a link to it", () => {
    expect(lint(company, changed(ana, { type: "verb" }))).toEqual([
      {
        path: "ana.md",
        rule: "basis/type",
        field: "/type",
        message: expect.stringMatching(
          /verb is not a type of the schema company or its imports/,
        ),
      },
    ]);
  });
});

describe("the lint of a type with a key", () => {
  // Like one company's capability on que's: one capability for each agent and its name there.
  const keyed = defineSchema({
    name: "keyed",
    description: "d",
    imports: [core],
    types: {
      capability: extendType(core.types.capability, {
        fields: {
          heldBy: one(() => core.types.agent),
          localName: z.string().min(1),
        },
        key: ["heldBy", "localName"],
      }),
    },
  });
  const agentNote = (name: string) =>
    note(`${name}.md`, { type: "agent", description: "d", role: "r" });
  const capabilityNote = (path: string, heldBy: string, localName: string) =>
    note(path, {
      type: "capability",
      description: "d",
      title: "Ship",
      heldBy,
      localName,
    });
  const agents = [agentNote("ana"), agentNote("bo")];
  const ship = capabilityNote("ship.md", "[[ana]]", "ship");

  it("gives a problem for each of two notes with one key, naming the other, and compares a link by the name it points at", () => {
    const twin = capabilityNote("copies/ana-ship.md", "[[ana]]", "ship");
    const key = 'heldBy "ana", localName "ship"';
    expect(lint(keyed, [...agents, ship, twin])).toEqual([
      {
        path: "copies/ana-ship.md",
        rule: "basis/key",
        message: `The key ${key} of the type capability is also the key of ship.md.`,
      },
      {
        path: "ship.md",
        rule: "basis/key",
        message: `The key ${key} of the type capability is also the key of copies/ana-ship.md.`,
      },
    ]);
  });

  it("gives no problem for two notes that share some of the key, and a link to each name resolves to that note", () => {
    const boShip = capabilityNote("bo-ship.md", "[[bo]]", "ship");
    const cases = ["ship", "bo-ship"].map((name) =>
      note(`${name}-works.md`, {
        type: "case",
        description: "d",
        capability: `[[${name}]]`,
      }),
    );
    expect(lint(keyed, [...agents, ship, boShip, ...cases])).toEqual([]);
  });

  it("compares a note whose other fields have problems, and not one whose key field has one", () => {
    const twin = without(
      capabilityNote("ana-ship.md", "[[ana]]", "ship"),
      "title",
    );
    expect(lint(keyed, [...agents, ship, twin]).map((p) => p.path)).toEqual([
      "ana-ship.md",
      "ana-ship.md",
      "ship.md",
    ]);
    const unlinked = capabilityNote("ana-ship.md", "ana", "ship");
    expect(lint(keyed, [...agents, ship, unlinked])).toEqual([
      {
        path: "ana-ship.md",
        rule: "basis/fields",
        field: "/heldBy",
        message: 'Not a wikilink, "[[name]]".',
      },
    ]);
  });
});

describe("the lint of two types with a key", () => {
  it("gives no problem for notes of two types with the same key values: the type is part of the key", () => {
    const keyedType = <const N extends string>(name: N) =>
      defineType({
        name,
        description: "d",
        fields: { code: z.string() },
        key: ["code"],
      });
    const schema = defineSchema({
      name: "p",
      description: "d",
      types: { a: keyedType("a"), b: keyedType("b") },
      typeNotes,
    });
    expect(
      lint(schema, [
        note("one.md", { type: "a", description: "d", code: "x" }),
        note("two.md", { type: "b", description: "d", code: "x" }),
      ]),
    ).toEqual([]);
  });
});

describe("the lint of a link with several targets", () => {
  // Like one company's capability: held by a source or by a domain.
  const plain = <const N extends string>(name: N) =>
    defineType({ name, description: "d", fields: {} });
  const source = plain("source");
  const domain = plain("domain");
  const verb = plain("verb");
  const capability = defineType({
    name: "capability",
    description: "d",
    fields: {
      heldBy: one(() => [source, domain]),
      localName: z.string(),
      touches: many(() => [source, domain]),
    },
    key: ["heldBy", "localName"],
  });
  const schema = defineSchema({
    name: "p",
    description: "d",
    types: { source, domain, verb, capability },
    typeNotes,
  });
  const notes = [
    note("till.md", { type: "source", description: "d" }),
    note("recipes.md", { type: "domain", description: "d" }),
    note("push.md", { type: "verb", description: "d" }),
  ];
  const capabilityNote = (
    path: string,
    heldBy: string,
    localName = "ship",
    touches = ["[[till]]", "[[recipes]]"],
  ) =>
    note(path, {
      type: "capability",
      description: "d",
      heldBy: `[[${heldBy}]]`,
      localName,
      touches,
    });

  it("gives no problem for a link to a note of any of its types", () => {
    expect(
      lint(schema, [
        ...notes,
        capabilityNote("a.md", "till"),
        capabilityNote("b.md", "recipes"),
      ]),
    ).toEqual([]);
  });

  it("gives a problem for a note of another type that names each type, and for a name that is no note", () => {
    expect(
      lint(schema, [
        ...notes,
        capabilityNote("a.md", "push"),
        capabilityNote("b.md", "nobody"),
      ]),
    ).toEqual([
      {
        path: "a.md",
        rule: "basis/link",
        field: "/heldBy",
        message:
          "It points at push, which is a verb, not a source or a domain.",
      },
      {
        path: "b.md",
        rule: "basis/link",
        field: "/heldBy",
        message: "It points at nobody, which is not a node.",
      },
    ]);
  });

  it("gives a problem for one name of a list that is a note of another type, naming each type", () => {
    expect(
      lint(schema, [
        ...notes,
        capabilityNote("a.md", "till", "ship", ["[[recipes]]", "[[push]]"]),
      ]),
    ).toEqual([
      {
        path: "a.md",
        rule: "basis/link",
        field: "/touches",
        message:
          "It points at push, which is a verb, not a source or a domain.",
      },
    ]);
  });

  it("is a key field, compared by the name it points at", () => {
    const key = 'heldBy "recipes", localName "ship"';
    expect(
      lint(schema, [
        ...notes,
        capabilityNote("a.md", "recipes"),
        capabilityNote("b.md", "recipes"),
      ]),
    ).toEqual([
      {
        path: "a.md",
        rule: "basis/key",
        message: `The key ${key} of the type capability is also the key of b.md.`,
      },
      {
        path: "b.md",
        rule: "basis/key",
        message: `The key ${key} of the type capability is also the key of a.md.`,
      },
    ]);
  });
});

describe("the lint of a link to node", () => {
  // Like a work item, that can belong to a note of any type.
  const plain = <const N extends string>(name: N) =>
    defineType({ name, description: "d", fields: {} });
  const app = plain("app");
  const doc = plain("doc");
  const task = defineType({
    name: "task",
    description: "d",
    fields: { belongsTo: one(() => node) },
  });
  const seen: string[] = [];
  const named = defineRule({
    name: "named",
    description: "Keeps the name of each node it runs on.",
    on: node,
    check: (each) => {
      // Of its own type: a node of node is of any type.
      seen.push(each.type === "app" ? `${each.name} app` : each.name);
      return [];
    },
  });
  const schema = defineSchema({
    name: "p",
    description: "d",
    types: { app, doc, task },
    typeNotes,
    rules: [named],
  });
  const notes = [
    note("landl.md", { type: "app", description: "d" }),
    note("guide.md", { type: "doc", description: "d" }),
  ];
  const taskNote = (path: string, belongsTo: string) =>
    note(path, {
      type: "task",
      description: "d",
      belongsTo: `[[${belongsTo}]]`,
    });

  it("gives no problem for a link to a note of any type, and runs a rule on node on every node", () => {
    seen.length = 0;
    expect(
      lint(schema, [
        ...notes,
        taskNote("a.md", "landl"),
        taskNote("b.md", "guide"),
        taskNote("c.md", "a"),
      ]),
    ).toEqual([]);
    expect(seen.sort()).toEqual(["a", "b", "c", "guide", "landl app"]);
  });

  it("gives a problem for a name that is no node, and for a note of type node", () => {
    expect(
      lint(schema, [
        ...notes,
        taskNote("a.md", "nobody"),
        note("bare.md", { type: "node", description: "d" }),
      ]).map(({ path, rule }) => `${path} ${rule}`),
    ).toEqual(["a.md basis/link", "bare.md basis/type"]);
  });
});

describe("the lint of a type note", () => {
  it("gives no problem for a note of the built-in type type under a schema that imports nothing", () => {
    const typeNote = note("source.md", {
      type: "type",
      description: "A place data lives.",
    });
    expect(things.imports).toEqual([]);
    expect(lint(things, [...right, typeNote])).toEqual([]);
  });

  it("gives a problem for a type note whose abstract is not true", () => {
    const typeNote = note("source.md", {
      type: "type",
      description: "A place data lives.",
      abstract: false,
    });
    expect(lint(things, [...right, typeNote])).toEqual([
      {
        path: "source.md",
        rule: "basis/fields",
        field: "/abstract",
        message: expect.stringMatching(/^Invalid/),
      },
    ]);
  });
});

describe("the lint of a type note, in a schema that imports an extension of the built-in type", () => {
  const owned = defineSchema({
    name: "owned",
    description: "d",
    types: { type: extendType(type, { fields: { owner: z.string() } }) },
  });
  const above = defineSchema({
    name: "above",
    description: "d",
    imports: [owned],
    types: {},
  });
  const withBasis = defineSchema({
    name: "with-basis",
    description: "d",
    imports: [above, basis],
    types: {},
  });
  const typeNote = note("source.md", {
    type: "type",
    description: "A place data lives.",
  });
  const ownedNote = edit(typeNote, { ...typeNote.fields, owner: "ana" });

  it("parses a type note by the extension, with or without an import of basis", () => {
    for (const schema of [above, withBasis]) {
      expect(lint(schema, [typeNote])).toEqual([
        {
          path: "source.md",
          rule: "basis/fields",
          field: "/owner",
          message: expect.stringMatching(/^Missing: /),
        },
      ]);
      expect(lint(schema, [ownedNote])).toEqual([]);
    }
  });
});

describe("the lint of a type with no key", () => {
  it("gives no problem for two notes with the same fields: only the name is one note's own", () => {
    expect(
      lint(things, [...right, { ...loaf, path: "roll.md", name: "roll" }]),
    ).toEqual([]);
  });
});

describe("a folder", () => {
  it("is linted with the loader's problems and the lint's, in path order, and a link to a note the loader could not read is not a problem", async () => {
    // oven.md cannot be read, and loaf.md, which is right, links to it.
    const folder = fileURLToPath(new URL("../fixtures/lint", import.meta.url));
    const problems = await lintFolder(things, folder);
    expect(problems.map((p) => p.path)).toEqual([
      "bun.md",
      "do-bake.md",
      "oven.md",
      "scone.md",
    ]);
  });

  it("lints no note under a path skip names", async () => {
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    await mkdir(join(root, "code"));
    await writeFile(
      join(root, "slate.md"),
      '---\ntype: source\ndescription: "A source."\nrole: entry\n---\n',
    );
    await writeFile(join(root, "code/README.md"), "No frontmatter.\n");
    expect(await lintFolder(things, root)).toMatchObject([
      { path: "code/README.md" },
    ]);
    expect(
      await lintFolder(things, root, { skip: (path) => path === "code" }),
    ).toEqual([]);
  });

  it("gives a symbolic link its own problem, and none to the note it points at", async () => {
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    await mkdir(join(root, "a"));
    await mkdir(join(root, "b"));
    await writeFile(
      join(root, "a/slate.md"),
      '---\ntype: source\ndescription: "A source."\nrole: entry\n---\n',
    );
    await symlink("../a/slate.md", join(root, "b/slate.md"));
    const problems = await lintFolder(things, root);
    expect(problems.map((p) => p.path)).toEqual(["b/slate.md"]);
  });
});

describe("the sources of a folder", () => {
  // A folder with one note, slate, and a source of pieces in code beside it.
  async function folderWithSlate() {
    const root = await mkdtemp(join(tmpdir(), "basis-sources-"));
    made.push(root);
    await writeFile(
      join(root, "slate.md"),
      '---\ntype: source\ndescription: "Where recipes are written."\nrole: entry\n---\n',
    );
    return root;
  }
  const node = (
    path: string,
    name: string,
    fields: Record<string, unknown>,
  ) => ({
    path,
    name,
    fields,
  });
  const till = node("code/till.ts", "till", {
    type: "source",
    description: "The shop's till.",
    role: "projection",
  });
  const tillItem = node("code/till.ts", "till-item", {
    type: "external-object",
    description: "A loaf as the till holds it.",
    heldIn: "till",
  });
  const loaf = node("code/loaf.ts", "loaf", {
    type: "object",
    description: "One bake of one dough.",
    key: "loaf_code",
    livesIn: ["slate"],
    states: ["drafted"],
    representedAs: ["till-item"],
  });
  const gives =
    (...pieces: Omit<Piece, "body" | "source">[]): Source =>
    () => ({ pieces, problems: [], unread: [] });

  it("lints the pieces of each source and the folder's notes as one graph: a link can cross from one to the other", async () => {
    const root = await folderWithSlate();
    expect(
      await lintFolder(things, root, {
        sources: [gives(till, tillItem), async () => gives(loaf)()],
      }),
    ).toEqual([]);
  });

  it("checks a source's node against its type, by the path the source gives", async () => {
    const root = await folderWithSlate();
    const wrong = node("code/till.ts", "till", {
      type: "source",
      description: "The shop's till.",
      role: "till",
    });
    expect(
      await lintFolder(things, root, { sources: [gives(wrong)] }),
    ).toMatchObject([
      { path: "code/till.ts", rule: "basis/fields", field: "/role" },
    ]);
  });

  it("merges a note and a source's piece of one name and one type into one node: a field both give is a problem on each", async () => {
    const root = await folderWithSlate();
    const twin = node("code/slate.ts", "slate", {
      type: "source",
      description: "Another slate.",
    });
    expect(
      (await lintFolder(things, root, { sources: [gives(twin)] })).map((p) => [
        p.path,
        p.rule,
        p.field,
      ]),
    ).toEqual([
      ["code/slate.ts", "basis/merge", "/description"],
      ["slate.md", "basis/merge", "/description"],
    ]);
  });

  it("gives a name a note and a source's piece of another type share a problem on each", async () => {
    const root = await folderWithSlate();
    const other = node("code/slate.ts", "slate", {
      type: "object",
      description: "A slate as a thing.",
      key: "slate",
      livesIn: ["till"],
      states: ["drafted"],
    });
    expect(
      (await lintFolder(things, root, { sources: [gives(till, other)] })).map(
        (p) => [p.path, p.rule],
      ),
    ).toEqual([
      ["code/slate.ts", "basis/unique-name"],
      ["slate.md", "basis/unique-name"],
    ]);
  });

  it("keeps a source's problems, and a link to a thing it could not read is not a problem", async () => {
    const root = await folderWithSlate();
    const unreadable = {
      path: "code/oven.ts",
      message: "The oven cannot be read.",
      fatal: true as const,
    };
    const toOven = {
      ...loaf,
      fields: { ...loaf.fields, livesIn: ["oven"] },
    };
    expect(
      await lintFolder(things, root, {
        sources: [
          gives(till, tillItem, toOven),
          () => ({
            pieces: [],
            problems: [unreadable],
            unread: [{ path: "code/oven.ts", name: "oven" }],
          }),
        ],
      }),
    ).toEqual([unreadable]);
  });

  it("runs each rule on the pieces of a source", async () => {
    const root = await folderWithSlate();
    const noProjection = defineRule({
      name: "no-projection",
      description: "No source is a projection.",
      on: things.types.source,
      check: (source) =>
        source.role === "projection"
          ? [{ field: "/role", message: "A projection." }]
          : [],
    });
    const checked = defineSchema({
      name: "checked",
      description: "The bakery, with a rule.",
      types: {},
      imports: [things],
      rules: [noProjection],
    });
    expect(await lintFolder(checked, root, { sources: [gives(till)] })).toEqual(
      [
        {
          path: "code/till.ts",
          rule: "checked/no-projection",
          field: "/role",
          message: "A projection.",
        },
      ],
    );
  });

  it("names a node of a source by its name, not by a file name, when its name is wrong", async () => {
    const root = await folderWithSlate();
    const named = node("code/till.ts", "Till", {
      ...till.fields,
      name: "till",
    });
    expect(
      (await lintFolder(things, root, { sources: [gives(named)] })).map(
        (p) => p.message,
      ),
    ).toEqual([
      "Its name is not one of its fields. Remove it.",
      "The name Till is not a lowercase slug.",
    ]);
  });

  it("throws, naming the source, for a node of type type: a type note is a note, in the folder of its schema", async () => {
    const root = await folderWithSlate();
    const typeNode = node("code/source.ts", "source", {
      type: "type",
      description: "A place data lives.",
    });
    await expect(
      lintFolder(things, root, { sources: [gives(typeNode)] }),
    ).rejects.toThrow(
      "The source number 1 gave source, of type type: a type note is a note, in the folder its schema declares.",
    );
  });

  it("throws, naming the source, for a path that is not from the folder linted, or is a note's path", async () => {
    const root = await folderWithSlate();
    for (const path of [
      "/etc/till.ts",
      "../till.ts",
      "code/./till.ts",
      "code\\till.ts",
      "",
    ])
      await expect(
        lintFolder(things, root, { sources: [gives({ ...till, path })] }),
      ).rejects.toThrow(/^The source number 1 gave something other than/);
    await expect(
      lintFolder(things, root, {
        sources: [gives({ ...till, path: "slate.md" })],
      }),
    ).rejects.toThrow(
      "The source number 1 gave the path slate.md, which is the path of a note of the folder.",
    );
    await expect(
      lintFolder(things, root, {
        sources: [
          () => ({
            pieces: [],
            problems: [],
            unread: [{ path: "slate.md", name: "slate" }],
          }),
        ],
      }),
    ).rejects.toThrow(/gave the path slate.md/);
  });

  it("throws, naming the source, for a problem that is not fatal: a check of what a source read is a rule", async () => {
    const root = await folderWithSlate();
    for (const problem of [
      { path: "code/x.ts", rule: "basis/link", message: "fake", fatal: true },
      { path: "code/y.ts", message: "neither" },
    ])
      await expect(
        lintFolder(things, root, {
          sources: [
            () => ({ pieces: [], problems: [problem], unread: [] }) as never,
          ],
        }),
      ).rejects.toThrow(/^The source number 1 gave something other than/);
  });

  it("reads a link as a name: a note writes it [[name]], and another node gives the name", async () => {
    const root = await folderWithSlate();
    // The note links to a node of code, and the node of code to the note.
    await writeFile(
      join(root, "till-item.md"),
      '---\ntype: external-object\ndescription: "A loaf as the till holds it."\nheldIn: "[[till]]"\n---\n',
    );
    const toNote = node("code/loaf.ts", "loaf", {
      ...loaf.fields,
      livesIn: ["slate"],
    });
    expect(
      await lintFolder(things, root, { sources: [gives(till, toNote)] }),
    ).toEqual([]);
  });

  it("gives a problem for a link written as the other form: a note's without [[ ]], a node of code's with them", async () => {
    const root = await folderWithSlate();
    await writeFile(
      join(root, "till-item.md"),
      '---\ntype: external-object\ndescription: "A loaf as the till holds it."\nheldIn: till\n---\n',
    );
    const bracketed = node("code/loaf.ts", "loaf", {
      ...loaf.fields,
      livesIn: ["[[slate]]"],
      representedAs: [],
    });
    expect(
      await lintFolder(things, root, { sources: [gives(till, bracketed)] }),
    ).toEqual([
      {
        path: "code/loaf.ts",
        rule: "basis/fields",
        field: "/livesIn/0",
        message: "Not a lowercase slug.",
      },
      {
        path: "till-item.md",
        rule: "basis/fields",
        field: "/heldIn",
        message: 'Not a wikilink, "[[name]]".',
      },
    ]);
  });

  it("gives a rule and a key the name a link points at, from a note and from another node alike", async () => {
    const root = await folderWithSlate();
    const shelf = defineType({
      name: "shelf",
      description: "Where a loaf is kept, one shelf to a source.",
      fields: { of: one(() => things.types.source) },
      key: ["of"],
    });
    const seen: unknown[] = [];
    const reads = defineRule({
      name: "reads",
      description: "Keeps what it reads.",
      on: shelf,
      check: (node) => {
        seen.push(node.of);
        return [];
      },
    });
    const kept = defineSchema({
      name: "kept",
      description: "Shelves.",
      types: { shelf },
      imports: [things],
      typeNotes: new URL("../fixtures/types/kept/", import.meta.url),
      rules: [reads],
    });
    await writeFile(
      join(root, "top.md"),
      '---\ntype: shelf\ndescription: "The top shelf."\nof: "[[slate]]"\n---\n',
    );
    const low = node("code/low.ts", "low", {
      type: "shelf",
      description: "The low shelf.",
      of: "slate",
    });
    const problems = await lintFolder(kept, root, { sources: [gives(low)] });
    expect(seen).toEqual(["slate", "slate"]);
    expect(
      problems.filter((p) => p.rule === "basis/key").map((p) => p.path),
    ).toEqual(["code/low.ts", "top.md"]);
  });

  it("reads a node as a note only when its body is a string", () => {
    // An undefined body, as JavaScript can give one: its type has none.
    const item = { ...tillItem, body: undefined } as unknown as Piece;
    expect(lint(things, [till, item])).toEqual([]);
    expect(
      lint(things, [till, { ...tillItem, body: "" }]).map((p) => p.message),
    ).toEqual(['Not a wikilink, "[[name]]".']);
  });

  it("throws, naming the source, for a piece with a body: a note is the loader's, from the folder that holds it", async () => {
    const root = await folderWithSlate();
    const typed: Source = () => ({
      // @ts-expect-error A source's piece has no body.
      pieces: [{ ...till, body: "" }],
      problems: [],
      unread: [],
    });
    // As JavaScript can give them: a body, or a body that is undefined.
    const untyped = [undefined, "A loaf at the till.\n"].map(
      (body) =>
        (() => ({
          pieces: [{ ...till, body }],
          problems: [],
          unread: [],
        })) as unknown as Source,
    );
    for (const source of [typed, ...untyped])
      await expect(
        lintFolder(things, root, { sources: [source] }),
      ).rejects.toThrow(
        /^The source (typed|number 1) gave something other than [\s\S]*"body"/,
      );
  });

  it("throws, naming the source, when a source throws or gives something other than { pieces, problems, unread }", async () => {
    const root = await folderWithSlate();
    function plugins(): never {
      throw new Error("no plugins here");
    }
    await expect(
      lintFolder(things, root, { sources: [plugins] }),
    ).rejects.toThrow("The source plugins threw: no plugins here");
    await expect(
      lintFolder(things, root, {
        sources: [gives(till), () => ({ pieces: [till] }) as never],
      }),
    ).rejects.toThrow(
      /^The source number 2 gave something other than \{ pieces, problems, unread \}/,
    );
  });
});

describe("the type notes of a folder", () => {
  // Under fixtures/types: the folders of things, core and kitchen.
  const types = fileURLToPath(new URL("../fixtures/types", import.meta.url));
  const kitchenNotes = fileURLToPath(
    new URL("../fixtures/types/kitchen/", import.meta.url),
  );

  it("gives no problem when each type a schema owns, abstract or not, has its note in the folder the schema declares, and an extension has none", async () => {
    // company imports core and extends its capability, and declares no folder.
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    expect(await lintFolder(company, root)).toEqual([]);
  });

  it("reads a schema's folder by its URL, outside the folder it lints, and gives each problem by its path from that folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    const at = (file: string) => relative(root, join(kitchenNotes, file));
    expect((await lintFolder(kitchen, root)).map((p) => p.path)).toEqual(
      [
        "bun.md",
        "crumb.md",
        "loaf.md",
        "oven.md",
        "pan.md",
        "scone.md",
        "till.md",
      ].map(at),
    );
  });

  it("gives a problem, at the path the note should have, for a type with no note, abstract or not", async () => {
    const problems = await lintFolder(kitchen, types);
    expect(problems).toContainEqual({
      path: "kitchen/bun.md",
      rule: "basis/type-note",
      message:
        "The type bun of kitchen has no type note: make this note, of type type, with the description of bun.",
    });
    expect(problems).toContainEqual({
      path: "kitchen/pan.md",
      rule: "basis/type-note",
      message:
        "The type pan of kitchen has no type note: make this note, of type type, with the description of pan.",
    });
  });

  it("gives a problem for a type note whose description is not its type's", async () => {
    expect(await lintFolder(kitchen, types)).toContainEqual({
      path: "kitchen/loaf.md",
      rule: "basis/type-note-agrees",
      field: "/description",
      message:
        'Not the description of the type loaf of kitchen: make it "A loaf of bread."',
    });
  });

  it("gives a problem for a type note whose abstract is not its type's", async () => {
    const problems = await lintFolder(kitchen, types);
    expect(problems).toContainEqual({
      path: "kitchen/oven.md",
      rule: "basis/type-note-agrees",
      field: "/abstract",
      message:
        "Missing: the type oven of kitchen is abstract, so add abstract: true.",
    });
    expect(problems).toContainEqual({
      path: "kitchen/scone.md",
      rule: "basis/type-note-agrees",
      field: "/abstract",
      message:
        "True, and the type scone of kitchen is not abstract: remove it.",
    });
  });

  it("gives a problem for a type note in a schema's folder that names no type of that schema", async () => {
    expect(await lintFolder(kitchen, types)).toContainEqual({
      path: "kitchen/till.md",
      rule: "basis/type-note-type",
      message:
        "The schema kitchen has no type till: remove this type note, or give it the name of a type of kitchen.",
    });
  });

  it("gives one problem for a type note that cannot be read, in the folder it lints", async () => {
    const problems = await lintFolder(kitchen, types);
    expect(problems.filter((p) => p.path === "kitchen/crumb.md")).toEqual([
      {
        path: "kitchen/crumb.md",
        message: "The frontmatter has no closing line of ---.",
        fatal: true,
      },
    ]);
  });

  it("gives a problem for a type note in the folder it lints that is in the folder of no schema it sees", async () => {
    expect(await lintFolder(kitchen, types)).toContainEqual({
      path: "things/source.md",
      rule: "basis/type-note-folder",
      message:
        "A type note outside the folder of the type notes of each schema the lint sees: move it to the folder of its schema, one of ../../types, kitchen.",
    });
  });

  it("gives a problem for each type of a schema whose folder is not there", async () => {
    const away = defineSchema({
      name: "away",
      description: "d",
      types: { bun: defineType({ name: "bun", description: "d", fields: {} }) },
      typeNotes: new URL("../fixtures/types/away/", import.meta.url),
    });
    expect(await lintFolder(away, types)).toContainEqual({
      path: "away/bun.md",
      rule: "basis/type-note",
      message:
        "The type bun of away has no type note: make this note, of type type, with the description of bun.",
    });
  });

  // A new folder, with the files given, and a schema of one type, bun, whose type notes are in it.
  const bunNote = '---\ntype: type\ndescription: "A soft bread."\n---\n';
  async function folderWithBun(files: Record<string, string>) {
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const schema = defineSchema({
      name: "buns",
      description: "d",
      types: {
        bun: defineType({
          name: "bun",
          description: "A soft bread.",
          fields: {},
        }),
      },
      typeNotes: pathToFileURL(`${root}/`),
    });
    return { root, schema };
  }
  const basisTypes = fileURLToPath(new URL("../types", import.meta.url));

  it("finds each type note in its folder when it lints through a symbolic link", async () => {
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    await symlink(types, join(root, "types"));
    const inKitchen = (problems: { path: string }[]) =>
      problems.filter((p) => p.path.startsWith("kitchen/"));
    expect(inKitchen(await lintFolder(kitchen, join(root, "types")))).toEqual(
      inKitchen(await lintFolder(kitchen, types)),
    );
  });

  it("gives a type note read from a folder the problems the lint gives a note of type type", async () => {
    const { schema } = await folderWithBun({
      "bun.md":
        '---\ntype: type\ndescription: "A soft bread."\nname: bun\nabstract: false\nextra: 1\n---\n',
    });
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    const problems = await lintFolder(schema, root);
    expect(problems.map((p) => [p.rule, p.field])).toEqual([
      ["basis/name", "/name"],
      ["basis/fields", "/abstract"],
      ["basis/fields", "/extra"],
    ]);
  });

  it("gives a problem on a type note it cannot read, and reads the folder as the loader does: no dot file, no symbolic link", async () => {
    const { root: folder, schema } = await folderWithBun({
      "bun.md": bunNote,
      ".till.md": '---\ntype: type\ndescription: "d"\n---\n',
    });
    await symlink(join(folder, "bun.md"), join(folder, "roll.md"));
    await chmod(join(folder, "bun.md"), 0o000);
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    const problems = await lintFolder(schema, root);
    await chmod(join(folder, "bun.md"), 0o644);
    expect(problems).toEqual([
      {
        path: relative(root, join(folder, "bun.md")),
        message: expect.stringMatching(/^The file cannot be read: /),
        fatal: true,
      },
      {
        path: relative(root, join(folder, "roll.md")),
        message: "A symbolic link: basis reads only files and folders.",
        fatal: true,
      },
    ]);
  });

  it("names the folder it lints as . among the folders of type notes", async () => {
    const { root, schema } = await folderWithBun({
      "bun.md": bunNote,
      "loose/roll.md": '---\ntype: type\ndescription: "d"\n---\n',
    });
    expect(await lintFolder(schema, root)).toEqual([
      {
        path: "loose/roll.md",
        rule: "basis/type-note-folder",
        message: `A type note outside the folder of the type notes of each schema the lint sees: move it to the folder of its schema, one of ${relative(await realpath(root), basisTypes)}, ..`,
      },
    ]);
  });

  it("gives the problems of a note as the lint of notes in memory does", async () => {
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    await writeFile(
      join(root, "loaf.md"),
      '---\ntype: object\ndescription: "d"\nkey: "k"\nstates: [a]\nlivesIn: ["[[nope]]", "[[nope]]"]\n---\n',
    );
    const inMemory = lint(things, [
      note("loaf.md", {
        type: "object",
        description: "d",
        key: "k",
        states: ["a"],
        livesIn: ["[[nope]]", "[[nope]]"],
      }),
    ]);
    expect(inMemory).toHaveLength(2);
    expect(await lintFolder(things, root)).toEqual(inMemory);
  });

  it("reads no folder in the lint of notes in memory", () => {
    expect(lint(kitchen, [])).toEqual([]);
  });
});

const made: string[] = [];
afterEach(async () => {
  for (const root of made.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("the lint of abstract types", () => {
  const grain = defineType({
    name: "grain",
    description: "What is milled.",
    abstract: true,
    fields: { mill: z.string() },
    key: ["mill"],
  });
  const bread = defineType({
    name: "bread",
    description: "A bread.",
    parents: [grain],
    fields: {},
  });
  const flour = defineType({
    name: "flour",
    description: "A flour.",
    parents: [grain],
    fields: {},
  });
  const shelf = defineType({
    name: "shelf",
    description: "A shelf.",
    fields: { holds: many(() => grain) },
  });
  const bakery = defineSchema({
    name: "bakery",
    description: "d",
    types: { grain, bread, flour, shelf },
    typeNotes,
  });
  const rye = note("rye.md", {
    type: "bread",
    description: "d",
    mill: "north",
  });
  const spelt = note("spelt.md", {
    type: "flour",
    description: "d",
    mill: "south",
  });
  const top = note("top.md", {
    type: "shelf",
    description: "d",
    holds: ["[[rye]]", "[[spelt]]"],
  });

  it("gives no problem for a link to an abstract type that points at notes of the types that inherit it", () => {
    expect(lint(bakery, [rye, spelt, top])).toEqual([]);
  });

  it("gives a problem for a note of an abstract type", () => {
    const loose = note("loose.md", {
      type: "grain",
      description: "d",
      mill: "east",
    });
    expect(lint(bakery, [rye, spelt, top, loose])).toEqual([
      {
        path: "loose.md",
        rule: "basis/type",
        field: "/type",
        message:
          "The type grain is abstract: a node is of a type that inherits it.",
      },
    ]);
  });

  it("gives a problem for a link to an abstract type that points at a note of a type that does not inherit it", () => {
    const other = note("other.md", {
      type: "shelf",
      description: "d",
      holds: ["[[rye]]"],
    });
    const wrong = edit(top, { ...top.fields, holds: ["[[other]]"] });
    expect(lint(bakery, [rye, spelt, other, wrong])).toEqual([
      {
        path: "top.md",
        rule: "basis/link",
        field: "/holds",
        message: "It points at other, which is a shelf, not a grain.",
      },
    ]);
  });

  it("holds a key of an abstract type over the notes of every type that inherits it", () => {
    const sameMill = edit(spelt, { ...spelt.fields, mill: "north" });
    expect(lint(bakery, [rye, sameMill, top])).toEqual([
      {
        path: "rye.md",
        rule: "basis/key",
        field: "/mill",
        message:
          'The key mill "north" of the type grain is also the key of spelt.md.',
      },
      {
        path: "spelt.md",
        rule: "basis/key",
        field: "/mill",
        message:
          'The key mill "north" of the type grain is also the key of rye.md.',
      },
    ]);
  });
});

describe("the merge of pieces into a node", () => {
  const app = defineType({
    name: "app",
    description: "Software data lives in.",
    fields: {},
  });
  const capability = defineType({
    name: "capability",
    description: "An outcome someone asks for.",
    fields: {
      title: z.string().regex(/\S/),
      heldBy: oneOrNone(() => app),
      touches: many(() => app),
    },
  });
  const held = defineRule({
    name: "held",
    description: "A capability is held by an app.",
    on: capability,
    check: (node) =>
      node.heldBy ? [] : [{ field: "/heldBy", message: "Held by no app." }],
  });
  const fabric = defineSchema({
    name: "fabric",
    description: "d",
    types: { app, capability },
    typeNotes,
    rules: [held],
  });
  const db = note("landl-db.md", { type: "app", description: "The record." });
  // find-fabric, as warehouse's code gives it and as its note gives the rest.
  const inCode: Piece = {
    path: "code/warehouse.ts",
    name: "find-fabric",
    fields: {
      type: "capability",
      description: "List or look up fabrics.",
      title: "Find a fabric",
      touches: ["landl-db"],
    },
  };
  const asNote = note("find-fabric.md", {
    type: "capability",
    heldBy: "[[landl-db]]",
  });

  it("gives no problem for a node whose pieces give each field once, each link in its own syntax", () => {
    expect(lint(fabric, [db, inCode, asNote])).toEqual([]);
  });

  it("gives the node from every piece to a rule, and a report on a field is on the piece that gives it", () => {
    const seen: unknown[] = [];
    const looks = defineSchema({
      name: "looks",
      description: "d",
      imports: [fabric],
      types: {},
      rules: [
        defineRule({
          name: "look",
          description: "d",
          on: capability,
          check: (node) => {
            seen.push(node);
            return [
              { field: "/title", message: "Seen." },
              { field: "/heldBy", message: "Seen." },
              { message: "Seen." },
            ];
          },
        }),
      ],
    });
    expect(lint(looks, [db, inCode, asNote])).toEqual([
      {
        path: "code/warehouse.ts",
        rule: "looks/look",
        field: "/title",
        message: "Seen.",
      },
      {
        path: "find-fabric.md",
        rule: "looks/look",
        field: "/heldBy",
        message: "Seen.",
      },
      { path: "find-fabric.md", rule: "looks/look", message: "Seen." },
    ]);
    expect(seen).toEqual([
      {
        name: "find-fabric",
        type: "capability",
        description: "List or look up fabrics.",
        title: "Find a fabric",
        touches: ["landl-db"],
        heldBy: "landl-db",
      },
    ]);
  });

  it("gives a field two pieces give a problem on each, naming the other", () => {
    const copied = note("find-fabric.md", {
      type: "capability",
      title: "Find a fabric",
      heldBy: "[[landl-db]]",
    });
    expect(lint(fabric, [db, inCode, copied])).toEqual([
      {
        path: "code/warehouse.ts",
        rule: "basis/merge",
        field: "/title",
        message:
          "Also given by find-fabric.md: each field comes from one piece. Remove it from all but one.",
      },
      {
        path: "find-fabric.md",
        rule: "basis/merge",
        field: "/title",
        message:
          "Also given by code/warehouse.ts: each field comes from one piece. Remove it from all but one.",
      },
    ]);
  });

  it("gives a note whose code piece is gone the fields the code gave, as missing, on the note", () => {
    expect(lint(fabric, [db, asNote])).toEqual([
      {
        path: "find-fabric.md",
        rule: "basis/fields",
        field: "/description",
        message: "Missing: its type needs a string here.",
      },
      {
        path: "find-fabric.md",
        rule: "basis/fields",
        field: "/title",
        message: "Missing: its type needs a string here.",
      },
      {
        path: "find-fabric.md",
        rule: "basis/fields",
        field: "/touches",
        message: "Missing: its type needs a array here.",
      },
    ]);
  });

  it("puts a problem of a field on the piece that gives it, and one of no piece's field on the note, or with no note on the first piece", () => {
    const wrongCode: Piece = {
      ...inCode,
      fields: { ...inCode.fields, title: " ", touches: ["nowhere"] },
    };
    const wrongNote = note("find-fabric.md", {
      type: "capability",
      heldBy: "[[nowhere]]",
      colour: "blue",
    });
    expect(
      lint(fabric, [db, wrongCode, wrongNote]).map((p) => [
        p.path,
        p.rule,
        p.field,
      ]),
    ).toEqual([
      ["code/warehouse.ts", "basis/fields", "/title"],
      ["code/warehouse.ts", "basis/link", "/touches"],
      ["find-fabric.md", "basis/fields", "/colour"],
      ["find-fabric.md", "basis/link", "/heldBy"],
    ]);
    const second: Piece = {
      path: "code/z-more.ts",
      name: "find-fabric",
      fields: { type: "capability", heldBy: "landl-db" },
    };
    const noTitle = Object.fromEntries(
      Object.entries(inCode.fields).filter(([field]) => field !== "title"),
    );
    expect(lint(fabric, [second, { ...inCode, fields: noTitle }, db])).toEqual([
      {
        path: "code/warehouse.ts",
        rule: "basis/fields",
        field: "/title",
        message: "Missing: its type needs a string here.",
      },
    ]);
  });

  it("reads each link in its own piece's syntax: a note's as a wikilink, a source's as a name", () => {
    const bareInNote = note("find-fabric.md", {
      type: "capability",
      heldBy: "landl-db",
    });
    const wikiInCode: Piece = {
      ...inCode,
      fields: { ...inCode.fields, touches: ["[[landl-db]]"] },
    };
    expect(
      lint(fabric, [db, inCode, bareInNote]).map((p) => [p.path, p.field]),
    ).toEqual([["find-fabric.md", "/heldBy"]]);
    expect(
      lint(fabric, [db, wikiInCode, asNote]).map((p) => [p.path, p.field]),
    ).toEqual([["code/warehouse.ts", "/touches/0"]]);
  });

  it("does not merge two pieces of one name from one source: a source gives each name once, and they share a name", async () => {
    const twice: Piece[] = [
      { ...inCode, source: "1" },
      {
        path: "code/other.ts",
        name: "find-fabric",
        source: "1",
        fields: { type: "capability", heldBy: "landl-db" },
      },
    ];
    expect(
      lint(fabric, [db, ...twice])
        .filter((p) => p.rule === "basis/unique-name")
        .map((p) => p.path),
    ).toEqual(["code/other.ts", "code/warehouse.ts"]);
    const root = await mkdtemp(join(tmpdir(), "basis-twice-"));
    made.push(root);
    await mkdir(join(root, "types"));
    for (const [type, text] of [
      ["app", "Software data lives in."],
      ["capability", "An outcome someone asks for."],
    ])
      await writeFile(
        join(root, "types", `${type}.md`),
        `---\ntype: type\ndescription: "${text}"\n---\n`,
      );
    await writeFile(
      join(root, "landl-db.md"),
      '---\ntype: app\ndescription: "The record."\n---\n',
    );
    const schema = defineSchema({
      ...fabric,
      typeNotes: pathToFileURL(join(root, "types/")),
    });
    const given: Source = () => ({
      pieces: twice.map(({ path, name, fields }) => ({ path, name, fields })),
      problems: [],
      unread: [],
    });
    expect(
      (await lintFolder(schema, root, { sources: [given] }))
        .filter((p) => p.rule === "basis/unique-name")
        .map((p) => p.path),
    ).toEqual(["code/other.ts", "code/warehouse.ts"]);
  });

  it("merges the pieces of several sources, with no note", () => {
    const fromLandl: Piece = {
      path: "landl/fabric.ts",
      name: "find-fabric",
      fields: { type: "capability", heldBy: "landl-db" },
    };
    expect(lint(fabric, [db, inCode, fromLandl])).toEqual([]);
  });

  it("does not merge two notes of one name, or pieces of two types: each is a node, and they share a name", () => {
    const again = note("other/find-fabric.md", {
      type: "capability",
      heldBy: "[[landl-db]]",
    });
    expect(
      lint(fabric, [db, inCode, asNote, again])
        .filter((p) => p.rule === "basis/unique-name")
        .map((p) => p.path),
    ).toEqual(["code/warehouse.ts", "find-fabric.md", "other/find-fabric.md"]);
    const anApp: Piece = {
      path: "code/apps.ts",
      name: "find-fabric",
      fields: { type: "app", description: "An app." },
    };
    expect(
      lint(fabric, [db, inCode, asNote, anApp])
        .filter((p) => p.rule === "basis/unique-name")
        .map((p) => p.path),
    ).toEqual(["code/apps.ts", "code/warehouse.ts", "find-fabric.md"]);
  });

  it("keeps a field named __proto__ as a field: the world stays closed", () => {
    const proto = note("find-fabric.md", {
      type: "capability",
      heldBy: "[[landl-db]]",
    });
    Object.defineProperty(proto.fields, "__proto__", {
      value: "x",
      enumerable: true,
    });
    expect(
      lint(fabric, [db, inCode, proto]).map((p) => [p.path, p.rule, p.field]),
    ).toEqual([["find-fabric.md", "basis/fields", "/__proto__"]]);
  });

  it("counts a note it could not read as a second note of a name, and another thing it could not read as no duplicate", () => {
    const unread = (note?: true) => [
      { path: "find-fabric.md", name: "find-fabric", ...(note && { note }) },
    ];
    // A source's piece, and a note that could not be read: the note may be its other piece.
    const names = (problems: readonly { rule?: string }[]) =>
      problems.filter((p) => p.rule === "basis/unique-name");
    expect(names(lint(fabric, [db, inCode], unread(true)))).toEqual([]);
    // A note, and a note that could not be read: two notes of one name.
    const other = { ...asNote, path: "other/find-fabric.md" };
    expect(
      lint(fabric, [db, inCode, other], unread(true)).map((p) => p.rule),
    ).toEqual(["basis/unique-name"]);
    // A note, and a thing a source could not read: it may be the code's piece.
    expect(lint(fabric, [db, inCode, asNote], unread())).toEqual([]);
  });

  it("gives the same problems, in the same order, whatever the order of the pieces", () => {
    // Pieces of three names, each of whose fields one or more pieces give, some of them wrong.
    const pieceOf = fc.record({
      name: fc.constantFrom("find-fabric", "find-company", "landl-db"),
      note: fc.boolean(),
      at: fc.constantFrom("a", "b", "c"),
      type: fc.constantFrom("capability", "app"),
      fields: fc.dictionary(
        fc.constantFrom("description", "title", "heldBy", "touches", "colour"),
        fc.constantFrom<unknown>(
          "d",
          " ",
          "landl-db",
          "[[landl-db]]",
          ["landl-db"],
          ["[[landl-db]]"],
          [],
        ),
      ),
    });
    const toPiece = (p: {
      name: string;
      note: boolean;
      at: string;
      type: string;
      fields: Record<string, unknown>;
    }): Piece => ({
      path: p.note ? `${p.at}/${p.name}.md` : `code/${p.at}.ts`,
      name: p.name,
      fields: { ...p.fields, type: p.type },
      ...(p.note && { body: "" }),
    });
    fc.assert(
      fc.property(
        fc.array(pieceOf, { maxLength: 8 }).map((ps) => ps.map(toPiece)),
        fc.func(fc.integer()),
        (pieces, rank) => {
          const shuffled = pieces
            .map((piece, i) => ({ piece, k: rank(i) }))
            .sort((x, y) => x.k - y.k)
            .map(({ piece }) => piece);
          expect(lint(fabric, shuffled)).toEqual(lint(fabric, pieces));
        },
      ),
    );
  });

  it("counts a field set to undefined as not given", () => {
    const blank: Piece = {
      ...inCode,
      fields: { ...inCode.fields, heldBy: undefined },
    };
    expect(lint(fabric, [db, blank, asNote])).toEqual([]);
  });

  it("orders pieces of one path and name by all of their fields, however long", () => {
    // Lists that differ only past the 100th item, where inspect stops by default.
    const [a, b]: Piece[] = ["landl-db", "nowhere"].map((last, i) => ({
      path: "code/x.ts",
      name: "find-fabric",
      source: String(i),
      fields: {
        type: "capability",
        touches: [...Array.from({ length: 100 }, () => "landl-db"), last],
      },
    }));
    if (!a || !b) throw new Error("two pieces");
    expect(lint(fabric, [db, b, a, asNote])).toEqual(
      lint(fabric, [db, a, b, asNote]),
    );
  });

  it("names the source when the piece that also gives a field has the same path", () => {
    const [a, b]: Piece[] = ["0", "1"].map((source) => ({
      ...inCode,
      source,
    }));
    if (!a || !b) throw new Error("two pieces");
    const merge = lint(fabric, [db, a, b, asNote]).find(
      (p) => p.rule === "basis/merge",
    );
    expect(merge?.message).toMatch(
      /^Also given by code\/warehouse\.ts \(source [01]\)/,
    );
  });

  it("gives a rule the node of a name a source could not read a thing of", () => {
    let got: unknown;
    const reads = defineSchema({
      name: "reads",
      description: "d",
      imports: [fabric],
      types: {},
      rules: [
        defineRule({
          name: "read",
          description: "d",
          on: app,
          check: (_node, graph) => {
            got = graph.get("find-fabric", capability);
            return [];
          },
        }),
      ],
    });
    lint(
      reads,
      [db, inCode, asNote],
      [{ path: "code/other.ts", name: "find-fabric" }],
    );
    expect(got).toMatchObject({ title: "Find a fabric" });
  });

  it("gives every field two pieces give a problem on each piece, and only those", () => {
    const fieldsOf = fc.dictionary(
      fc.constantFrom("description", "title", "heldBy", "touches"),
      fc.constant("x"),
    );
    fc.assert(
      fc.property(fc.array(fieldsOf, { minLength: 1, maxLength: 4 }), (all) => {
        const pieces: Piece[] = all.map((fields, i) => ({
          path: `code/${i}.ts`,
          name: "find-fabric",
          fields: { ...fields, type: "capability" },
        }));
        const expected = all.flatMap((fields, i) =>
          Object.keys(fields)
            .filter((field) =>
              all.some((other, j) => j !== i && Object.hasOwn(other, field)),
            )
            .map((field) => `code/${i}.ts /${field}`),
        );
        expect(
          lint(fabric, pieces)
            .filter((p) => p.rule === "basis/merge")
            .map((p) => `${p.path} ${p.field}`)
            .sort(),
        ).toEqual(expected.sort());
      }),
    );
  });
});

describe("a link's own message", () => {
  // Like que's plugins: an op names one of its plugin's roles.
  const accessRole = defineType({
    name: "access-role",
    description: "d",
    fields: {},
  });
  const local = (name: string) => name.replace(/^dagster-/, "");
  // Annotated: the message reads the plugins, whose ops link to the op that holds the message.
  const failures: LinkFailure[] = [];
  const roleMessage = (f: LinkFailure, graph: Graph): string | undefined => {
    failures.push(f);
    if (f.kind !== "not-a-node") return undefined;
    const held: { name: string; roles?: string[] | undefined } | undefined =
      graph.all(plugin).find((p) => p.ops?.includes(f.node));
    if (!held) return undefined;
    const roles = (held.roles ?? []).map(local).join(", ");
    return `${local(f.target)} is not one of ${held.name}'s roles (${roles}).`;
  };
  const op = defineType({
    name: "op",
    description: "d",
    fields: { role: oneOrNone(() => accessRole, { message: roleMessage }) },
  });
  // An op whose message gives each field of a wrong-type failure.
  const opWith = defineType({
    name: "op-with",
    description: "d",
    fields: {
      role: oneOrNone(() => accessRole, {
        message: (f) =>
          f.kind === "wrong-type"
            ? `${f.node} -> ${f.target}: ${f.targetType}`
            : undefined,
      }),
    },
  });
  const plugin = defineType({
    name: "plugin",
    description: "d",
    fields: {
      roles: manyOrNone(() => accessRole),
      ops: manyOrNone(() => [op, opWith]),
    },
  });
  const schema = defineSchema({
    name: "p",
    description: "d",
    types: { "access-role": accessRole, op, "op-with": opWith, plugin },
    typeNotes,
  });
  // A schema of one type of op, with the message given.
  const opSchema = (message: (f: LinkFailure) => unknown) =>
    defineSchema({
      name: "q",
      description: "d",
      types: {
        "access-role": accessRole,
        "other-op": defineType({
          name: "other-op",
          description: "d",
          fields: {
            role: oneOrNone(() => accessRole, {
              message: message as (f: LinkFailure) => string | undefined,
            }),
          },
        }),
      },
      typeNotes,
    });
  const roles = [
    note("roles/dagster-read-only.md", {
      type: "access-role",
      description: "d",
    }),
    note("roles/dagster-trigger.md", { type: "access-role", description: "d" }),
  ];
  const dagster = (path: string) =>
    note(path, {
      type: "plugin",
      description: "d",
      roles: ["[[dagster-read-only]]", "[[dagster-trigger]]"],
      ops: ["[[dagster-run]]"],
    });
  const run = (role: unknown, opType = "op") =>
    note("ops/dagster-run.md", { type: opType, description: "d", role });

  it("is the message of the one problem of a link to no node, from the graph", () => {
    expect(
      lint(schema, [...roles, dagster("dagster.md"), run("[[dagster-admin]]")]),
    ).toEqual([
      {
        path: "ops/dagster-run.md",
        rule: "basis/link",
        field: "/role",
        message: "admin is not one of dagster's roles (read-only, trigger).",
      },
    ]);
  });

  it("reads every node of the graph, also one after its node by path", () => {
    expect(
      lint(schema, [
        ...roles,
        dagster("plugins/dagster.md"),
        run("[[dagster-admin]]"),
      ]).map((p) => p.message),
    ).toEqual(["admin is not one of dagster's roles (read-only, trigger)."]);
  });

  it("gives way to basis's message when it gives undefined", () => {
    failures.length = 0;
    expect(
      lint(schema, [...roles, dagster("dagster.md"), run("[[dagster]]")]),
    ).toEqual([
      {
        path: "ops/dagster-run.md",
        rule: "basis/link",
        field: "/role",
        message: "It points at dagster, which is a plugin, not a access-role.",
      },
    ]);
    expect(failures).toEqual([
      {
        kind: "wrong-type",
        node: "dagster-run",
        target: "dagster",
        targetType: "plugin",
      },
    ]);
  });

  it("is the message of a required link that gives no name, absent or an empty list", () => {
    const model = defineType({ name: "model", description: "d", fields: {} });
    const message = (f: LinkFailure) =>
      f.kind === "missing"
        ? "Missing: name a model config the deployment lists."
        : undefined;
    const agent = defineType({
      name: "agent",
      description: "d",
      fields: { model: one(() => model, { message }) },
    });
    const crew = defineType({
      name: "crew",
      description: "d",
      fields: { models: many(() => model, { message }) },
    });
    const harness = defineSchema({
      name: "harness",
      description: "d",
      types: { model, agent, crew },
      typeNotes,
    });
    expect(
      lint(harness, [
        note("a.md", { type: "agent", description: "d" }),
        note("c.md", { type: "crew", description: "d", models: [] }),
      ]),
    ).toEqual([
      {
        path: "a.md",
        rule: "basis/fields",
        field: "/model",
        message: "Missing: name a model config the deployment lists.",
      },
      {
        path: "c.md",
        rule: "basis/fields",
        field: "/models",
        message: "Missing: name a model config the deployment lists.",
      },
    ]);
  });

  it("gets the node by name, the target by name and the target's type", () => {
    expect(
      lint(schema, [
        ...roles,
        dagster("dagster.md"),
        run("[[dagster]]", "op-with"),
      ]).map((p) => p.message),
    ).toEqual(["dagster-run -> dagster: plugin"]);
  });

  it("goes with the link to a type that inherits it, and to an extension", () => {
    const target = defineType({ name: "target", description: "d", fields: {} });
    const base = defineType({
      name: "base",
      description: "d",
      fields: {
        to: one(() => target, {
          message: (f) =>
            f.kind === "not-a-node" ? `No ${f.target}.` : undefined,
        }),
      },
    });
    const child = defineType({
      name: "child",
      description: "d",
      parents: [base],
      fields: {},
    });
    const inner = defineSchema({
      name: "inner",
      description: "d",
      types: { target, base, child },
      typeNotes,
    });
    const outer = defineSchema({
      name: "outer",
      description: "d",
      imports: [inner],
      types: {
        base: extendType(base, { fields: { extra: z.string().optional() } }),
      },
    });
    const pieces = [
      note("b.md", { type: "base", description: "d", to: "[[nobody]]" }),
      note("c.md", { type: "child", description: "d", to: "[[nobody]]" }),
    ];
    expect(lint(outer, pieces).map((p) => `${p.path} ${p.message}`)).toEqual([
      "b.md No nobody.",
      "c.md No nobody.",
    ]);
  });

  it("leaves every problem of a link with none as it was", () => {
    const model = defineType({ name: "model", description: "d", fields: {} });
    const agent = defineType({
      name: "agent",
      description: "d",
      fields: {
        model: one(() => model),
        models: many(() => model),
        role: oneOrNone(() => accessRole),
      },
    });
    const plain = defineSchema({
      name: "plain",
      description: "d",
      types: { model, agent, "access-role": accessRole },
      typeNotes,
    });
    expect(
      lint(plain, [
        note("m.md", { type: "model", description: "d" }),
        note("a.md", { type: "agent", description: "d", models: [] }),
        note("b.md", {
          type: "agent",
          description: "d",
          model: "[[nobody]]",
          models: ["[[m]]"],
          role: "[[m]]",
        }),
        note("c.md", {
          type: "agent",
          description: "d",
          model: "m",
          models: ["[[m]]"],
        }),
      ]),
    ).toEqual([
      {
        path: "a.md",
        rule: "basis/fields",
        field: "/model",
        message: "Missing: its type needs a string here.",
      },
      {
        path: "a.md",
        rule: "basis/fields",
        field: "/models",
        message: "Too small: expected array to have >=1 items",
      },
      {
        path: "b.md",
        rule: "basis/link",
        field: "/model",
        message: "It points at nobody, which is not a node.",
      },
      {
        path: "b.md",
        rule: "basis/link",
        field: "/role",
        message: "It points at m, which is a model, not a access-role.",
      },
      {
        path: "c.md",
        rule: "basis/fields",
        field: "/model",
        message: 'Not a wikilink, "[[name]]".',
      },
    ]);
  });

  it("throws, naming the type, the link and the node, when it throws or gives other than a message or undefined", () => {
    const pieces = [...roles, run("[[dagster-admin]]", "other-op")];
    expect(() =>
      lint(
        opSchema(() => {
          throw new Error("no roles here");
        }),
        pieces,
      ),
    ).toThrow(
      "The message of the link role of other-op threw on ops/dagster-run.md: no roles here",
    );
    for (const given of ["", 5, null])
      expect(() =>
        lint(
          opSchema(() => given),
          pieces,
        ),
      ).toThrow(
        "The message of the link role of other-op gave something other than a message or undefined for ops/dagster-run.md.",
      );
  });

  it("is not called for a value that is not a wikilink, which keeps basis's message", () => {
    const calls: LinkFailure[] = [];
    const counted = opSchema((f) => {
      calls.push(f);
      return "never";
    });
    expect(lint(counted, [...roles, run("dagster-admin", "other-op")])).toEqual(
      [
        {
          path: "ops/dagster-run.md",
          rule: "basis/fields",
          field: "/role",
          message: 'Not a wikilink, "[[name]]".',
        },
      ],
    );
    expect(calls).toEqual([]);
  });

  it("is called once for each bad name of a many link, and each problem has its own", () => {
    const calls: LinkFailure[] = [];
    const bundle = defineType({
      name: "bundle",
      description: "d",
      fields: {
        roles: many(() => accessRole, {
          message: (f) => {
            calls.push(f);
            return f.kind === "not-a-node" ? `No ${f.target}.` : undefined;
          },
        }),
      },
    });
    const bundles = defineSchema({
      name: "bundles",
      description: "d",
      types: { bundle, "access-role": accessRole },
      typeNotes,
    });
    expect(
      lint(bundles, [
        ...roles,
        note("b.md", {
          type: "bundle",
          description: "d",
          roles: ["[[x]]", "[[dagster-trigger]]", "[[y]]"],
        }),
      ]).map((p) => `${p.field} ${p.message}`),
    ).toEqual(["/roles No x.", "/roles No y."]);
    expect(calls).toEqual([
      { kind: "not-a-node", node: "b", target: "x" },
      { kind: "not-a-node", node: "b", target: "y" },
    ]);
  });
});
