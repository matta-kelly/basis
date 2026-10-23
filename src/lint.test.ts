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
  one,
  type,
  loadFolder,
  type Loaded,
  type Node,
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
        [{ path: "a/oven.md", name: "oven" }],
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
  // A folder with one note, slate, and a source of nodes in code beside it.
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
    (...nodes: Node[]): Source =>
    () => ({ nodes, problems: [], unread: [] });

  it("lints the nodes of each source and the folder's notes as one graph: a link can cross from one to the other", async () => {
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

  it("gives a name a note and a source's node share a problem on each", async () => {
    const root = await folderWithSlate();
    const twin = node("code/slate.ts", "slate", {
      type: "source",
      description: "Another slate.",
      role: "entry",
    });
    expect(
      (await lintFolder(things, root, { sources: [gives(twin)] })).map((p) => [
        p.path,
        p.rule,
      ]),
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
            nodes: [],
            problems: [unreadable],
            unread: [{ path: "code/oven.ts", name: "oven" }],
          }),
        ],
      }),
    ).toEqual([unreadable]);
  });

  it("runs each rule on the nodes of a source", async () => {
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
            nodes: [],
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
            () => ({ nodes: [], problems: [problem], unread: [] }) as never,
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

  it("takes the notes of another folder from a source, and reads their links as a note writes them", async () => {
    const root = await folderWithSlate();
    const other = await mkdtemp(join(tmpdir(), "basis-other-"));
    made.push(other);
    await writeFile(
      join(other, "till.md"),
      '---\ntype: source\ndescription: "The till."\nrole: projection\n---\n',
    );
    await writeFile(
      join(other, "till-item.md"),
      '---\ntype: external-object\ndescription: "A loaf at the till."\nheldIn: "[[till]]"\n---\n',
    );
    async function otherFolder(): Promise<Loaded> {
      const read = await loadFolder(other);
      return {
        ...read,
        nodes: read.nodes.map((n) => ({ ...n, path: `other/${n.path}` })),
      };
    }
    expect(await lintFolder(things, root, { sources: [otherFolder] })).toEqual(
      [],
    );
  });

  it("reads a source's node as a note when it has a body, and as a node when its body is undefined", async () => {
    const root = await folderWithSlate();
    // An undefined body, as a source in JavaScript can give one: its type has none.
    const item = (body: string | undefined, heldIn: string) =>
      ({ ...tillItem, fields: { ...tillItem.fields, heldIn }, body }) as Node;
    expect(
      await lintFolder(things, root, {
        sources: [gives(till, item(undefined, "till"))],
      }),
    ).toEqual([]);
    expect(
      await lintFolder(things, root, {
        sources: [gives(till, item("A loaf at the till.\n", "[[till]]"))],
      }),
    ).toEqual([]);
  });

  it("throws, naming the source, when a source throws or gives something other than { nodes, problems, unread }", async () => {
    const root = await folderWithSlate();
    function plugins(): never {
      throw new Error("no plugins here");
    }
    await expect(
      lintFolder(things, root, { sources: [plugins] }),
    ).rejects.toThrow("The source plugins threw: no plugins here");
    await expect(
      lintFolder(things, root, {
        sources: [gives(till), () => ({ nodes: [till] }) as never],
      }),
    ).rejects.toThrow(
      /^The source number 2 gave something other than \{ nodes, problems, unread \}/,
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
