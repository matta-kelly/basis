import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { company, core } from "../fixtures/layers.ts";
import things from "../fixtures/things.ts";
import {
  basis,
  defineSchema,
  defineType,
  extendType,
  lint,
  lintFolder,
  many,
  one,
  type,
  type Note,
} from "./index.ts";

const note = (path: string, frontmatter: Record<string, unknown>): Note => ({
  path,
  name: basename(path, ".md"),
  frontmatter,
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
const edit = (n: Note, frontmatter: Record<string, unknown>): Note => ({
  ...n,
  frontmatter,
});
const without = (n: Note, field: string) =>
  edit(
    n,
    Object.fromEntries(
      Object.entries(n.frontmatter).filter(([key]) => key !== field),
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
          ...without(loaf, "key").frontmatter,
          colour: "blue",
          size: "large",
        }),
      ),
    );
    expect(problems).toHaveLength(3);
    expect(problems.every((p) => p.path === "loaf.md")).toBe(true);
    for (const field of ["key", "colour", "size"]) {
      expect(problems.some((p) => p.message.includes(field))).toBe(true);
    }
  });

  it("gives a problem for a note whose type the schema does not have, or is a name the object prototype has, or with no type", () => {
    expect(
      lint(
        things,
        withNote(edit(slate, { ...slate.frontmatter, type: "verb" })),
      ),
    ).toEqual([{ path: "slate.md", message: expect.stringMatching(/verb/) }]);
    expect(
      lint(
        things,
        withNote(edit(slate, { ...slate.frontmatter, type: "constructor" })),
      ),
    ).toEqual([
      { path: "slate.md", message: expect.stringMatching(/constructor/) },
    ]);
    expect(lint(things, withNote(without(slate, "type")))).toEqual([
      { path: "slate.md", message: expect.stringMatching(/no type/) },
    ]);
    expect(
      lint(things, withNote(edit(slate, { ...slate.frontmatter, type: null }))),
    ).toEqual([
      { path: "slate.md", message: expect.stringMatching(/no type/) },
    ]);
    expect(
      lint(things, withNote(edit(slate, { ...slate.frontmatter, type: 5 }))),
    ).toEqual([
      { path: "slate.md", message: expect.stringMatching(/5 is not a name/) },
    ]);
    expect(
      lint(things, withNote(edit(slate, { ...slate.frontmatter, type: "" }))),
    ).toEqual([
      { path: "slate.md", message: expect.stringMatching(/no type/) },
    ]);
    const loop: unknown[] = [];
    loop.push(loop);
    expect(
      lint(things, withNote(edit(slate, { ...slate.frontmatter, type: loop }))),
    ).toEqual([
      { path: "slate.md", message: expect.stringMatching(/is not a name/) },
    ]);
    expect(
      lint(
        things,
        withNote(edit(slate, { ...slate.frontmatter, type: ["source"] })),
      ),
    ).toEqual([
      {
        path: "slate.md",
        message: expect.stringMatching(/source.* is not a name/),
      },
    ]);
  });

  it("checks the links of a note that fails the zod schema of its type", () => {
    const problems = lint(
      things,
      withNote(
        edit(without(loaf, "key"), {
          ...without(loaf, "key").frontmatter,
          livesIn: ["[[nowhere]]"],
        }),
      ),
    );
    expect(problems.map((p) => p.message)).toEqual([
      expect.stringMatching(/key/),
      expect.stringMatching(/nowhere/),
    ]);
  });

  it("checks a link against a read note when an unread note has the same name, and reports the read one as a duplicate", () => {
    const oven = note("b/oven.md", {
      type: "external-object",
      description: "Read, and of the wrong type for livesIn.",
      heldIn: "[[till]]",
    });
    const linking = edit(loaf, {
      ...loaf.frontmatter,
      livesIn: ["[[slate]]", "[[oven]]"],
    });
    expect(lint(things, [...withNote(linking), oven], ["a/oven.md"])).toEqual([
      { path: "b/oven.md", message: expect.stringContaining("a/oven.md") },
      { path: "loaf.md", message: expect.stringMatching(/oven.*source/) },
    ]);
  });

  it("gives a problem for a link to a note that does not exist", () => {
    expect(
      lint(
        things,
        withNote(edit(loaf, { ...loaf.frontmatter, livesIn: ["[[nowhere]]"] })),
      ),
    ).toEqual([{ path: "loaf.md", message: expect.stringMatching(/nowhere/) }]);
  });

  it("gives a problem for a link to a note of the wrong type", () => {
    expect(
      lint(
        things,
        withNote(
          edit(loaf, {
            ...loaf.frontmatter,
            representedAs: ["[[slate]]"],
          }),
        ),
      ),
    ).toEqual([
      {
        path: "loaf.md",
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
        message: expect.stringContaining("slate.md"),
      },
      {
        path: "slate.md",
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
        message: expect.stringMatching(
          /file name Bad_Name is not a lowercase slug/,
        ),
      },
    ]);
  });

  it("gives a problem for a note that writes its own name", () => {
    expect(
      lint(
        things,
        withNote(edit(slate, { ...slate.frontmatter, name: "slate" })),
      ),
    ).toEqual([{ path: "slate.md", message: expect.stringMatching(/name/) }]);
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
  const changed = (n: Note, frontmatter: Record<string, unknown>) => [
    ...layered.filter((m) => m.path !== n.path),
    edit(n, { ...n.frontmatter, ...frontmatter }),
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
        edit(review, { ...review.frontmatter, of: "[[ana]]" }),
      ]),
    ).toEqual([
      {
        path: "ship-review.md",
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
      { path: "ship.md", message: expect.stringMatching(/stage/) },
    ]);
    expect(lint(company, changed(ana, { role: undefined }))).toEqual([
      { path: "ana.md", message: expect.stringMatching(/role/) },
    ]);
    // By core alone, a company capability has fields core does not know.
    expect(lint(core, layered).map((p) => p.message)).toEqual([
      expect.stringMatching(/stage/),
      expect.stringMatching(/heldBy/),
    ]);
  });

  it("gives a problem for a link to no note, and to a note of the wrong type, across the two schemas", () => {
    expect(lint(company, changed(ship, { heldBy: "[[nobody]]" }))).toEqual([
      {
        path: "ship.md",
        message: expect.stringMatching(
          /heldBy points at nobody, which is not a note/,
        ),
      },
    ]);
    expect(lint(company, changed(ship, { heldBy: "[[ship-works]]" }))).toEqual([
      {
        path: "ship.md",
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
        message: `The key ${key} of the type capability is also the key of ship.md.`,
      },
      {
        path: "ship.md",
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
      { path: "ana-ship.md", message: expect.stringMatching(/heldBy/) },
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
        message:
          "The link heldBy points at push, which is a verb, not a source or a domain.",
      },
      {
        path: "b.md",
        message: "The link heldBy points at nobody, which is not a note.",
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
        message:
          "The link touches points at push, which is a verb, not a source or a domain.",
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
        message: `The key ${key} of the type capability is also the key of b.md.`,
      },
      {
        path: "b.md",
        message: `The key ${key} of the type capability is also the key of a.md.`,
      },
    ]);
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
      { path: "source.md", message: expect.stringMatching(/^abstract: /) },
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
  const ownedNote = edit(typeNote, { ...typeNote.frontmatter, owner: "ana" });

  it("parses a type note by the extension, with or without an import of basis", () => {
    for (const schema of [above, withBasis]) {
      expect(lint(schema, [typeNote])).toEqual([
        { path: "source.md", message: expect.stringMatching(/^owner: /) },
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
        message:
          "The type grain is abstract: a note is of a type that inherits it.",
      },
    ]);
  });

  it("gives a problem for a link to an abstract type that points at a note of a type that does not inherit it", () => {
    const other = note("other.md", {
      type: "shelf",
      description: "d",
      holds: ["[[rye]]"],
    });
    const wrong = edit(top, { ...top.frontmatter, holds: ["[[other]]"] });
    expect(lint(bakery, [rye, spelt, other, wrong])).toEqual([
      {
        path: "top.md",
        message:
          "The link holds points at other, which is a shelf, not a grain.",
      },
    ]);
  });

  it("holds a key of an abstract type over the notes of every type that inherits it", () => {
    const sameMill = edit(spelt, { ...spelt.frontmatter, mill: "north" });
    expect(lint(bakery, [rye, sameMill, top])).toEqual([
      {
        path: "rye.md",
        message:
          'The key mill "north" of the type grain is also the key of spelt.md.',
      },
      {
        path: "spelt.md",
        message:
          'The key mill "north" of the type grain is also the key of rye.md.',
      },
    ]);
  });
});
