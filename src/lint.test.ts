import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import things from "../fixtures/things.ts";
import { lint, lintFolder, type Note } from "./index.ts";

const note = (path: string, frontmatter: Record<string, unknown>): Note => ({
  path,
  name: basename(path, ".md"),
  frontmatter,
  body: "",
});

const sheets = note("sheets.md", {
  type: "source",
  description: "Where product information is typed.",
  role: "entry",
});
const odoo = note("odoo.md", {
  type: "source",
  description: "The ERP.",
  role: "projection",
});
const fabric = note("fabric.md", {
  type: "object",
  description: "One print on one cloth.",
  key: "fabric_code",
  livesIn: ["[[sheets]]"],
  states: ["drafted", "complete"],
  representedAs: ["[[odoo-attribute-value]]"],
});
const attributeValue = note("odoo-attribute-value.md", {
  type: "external-object",
  description: "A fabric as Odoo holds it.",
  heldIn: "[[odoo]]",
});
const right = [sheets, odoo, fabric, attributeValue];

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
        edit(without(fabric, "key"), {
          ...without(fabric, "key").frontmatter,
          colour: "blue",
          size: "large",
        }),
      ),
    );
    expect(problems).toHaveLength(3);
    expect(problems.every((p) => p.path === "fabric.md")).toBe(true);
    for (const field of ["key", "colour", "size"]) {
      expect(problems.some((p) => p.message.includes(field))).toBe(true);
    }
  });

  it("gives a problem for a note whose type the package does not have, or with no type", () => {
    expect(
      lint(
        things,
        withNote(edit(sheets, { ...sheets.frontmatter, type: "verb" })),
      ),
    ).toEqual([{ path: "sheets.md", message: expect.stringMatching(/verb/) }]);
    expect(lint(things, withNote(without(sheets, "type")))).toEqual([
      { path: "sheets.md", message: expect.stringMatching(/no type/) },
    ]);
    expect(
      lint(
        things,
        withNote(edit(sheets, { ...sheets.frontmatter, type: null })),
      ),
    ).toEqual([
      { path: "sheets.md", message: expect.stringMatching(/no type/) },
    ]);
    expect(
      lint(things, withNote(edit(sheets, { ...sheets.frontmatter, type: 5 }))),
    ).toEqual([
      { path: "sheets.md", message: expect.stringMatching(/5 is not a name/) },
    ]);
    expect(
      lint(
        things,
        withNote(edit(sheets, { ...sheets.frontmatter, type: ["source"] })),
      ),
    ).toEqual([
      {
        path: "sheets.md",
        message: expect.stringContaining('["source"] is not a name'),
      },
    ]);
  });

  it("checks the links of a note that fails its schema", () => {
    const problems = lint(
      things,
      withNote(
        edit(without(fabric, "key"), {
          ...without(fabric, "key").frontmatter,
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
    const elm = note("b/elm.md", {
      type: "external-object",
      description: "Read, and of the wrong type for livesIn.",
      heldIn: "[[odoo]]",
    });
    const linking = edit(fabric, {
      ...fabric.frontmatter,
      livesIn: ["[[sheets]]", "[[elm]]"],
    });
    expect(lint(things, [...withNote(linking), elm], ["a/elm.md"])).toEqual([
      { path: "b/elm.md", message: expect.stringContaining("a/elm.md") },
      { path: "fabric.md", message: expect.stringMatching(/elm.*source/) },
    ]);
  });

  it("gives a problem for a link to a note that does not exist", () => {
    expect(
      lint(
        things,
        withNote(
          edit(fabric, { ...fabric.frontmatter, livesIn: ["[[nowhere]]"] }),
        ),
      ),
    ).toEqual([
      { path: "fabric.md", message: expect.stringMatching(/nowhere/) },
    ]);
  });

  it("gives a problem for a link to a note of the wrong type", () => {
    expect(
      lint(
        things,
        withNote(
          edit(fabric, {
            ...fabric.frontmatter,
            representedAs: ["[[sheets]]"],
          }),
        ),
      ),
    ).toEqual([
      {
        path: "fabric.md",
        message: expect.stringMatching(/sheets.*external-object/),
      },
    ]);
  });

  it("gives no problem for a link to a note that has its own problems", () => {
    const problems = lint(
      things,
      withNote(without(attributeValue, "description")),
    );
    expect(problems.map((p) => p.path)).toEqual(["odoo-attribute-value.md"]);
  });

  it("gives a problem for each of two notes with one name, naming the other", () => {
    const twin = { ...sheets, path: "copies/sheets.md" };
    expect(lint(things, [...right, twin])).toEqual([
      {
        path: "copies/sheets.md",
        message: expect.stringContaining("sheets.md"),
      },
      {
        path: "sheets.md",
        message: expect.stringContaining("copies/sheets.md"),
      },
    ]);
  });

  it("gives a problem for a note whose file name is not a slug, naming the file name", () => {
    expect(
      lint(things, [
        ...right,
        { ...odoo, path: "Bad_Name.md", name: "Bad_Name" },
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
        withNote(edit(sheets, { ...sheets.frontmatter, name: "sheets" })),
      ),
    ).toEqual([{ path: "sheets.md", message: expect.stringMatching(/name/) }]);
  });
});

describe("a folder", () => {
  it("is linted with the loader's problems and the lint's, in path order, and a link to a note the loader could not read is not a problem", async () => {
    // elm.md cannot be read, and fabric.md, which is right, links to it.
    const folder = fileURLToPath(new URL("../fixtures/lint", import.meta.url));
    const problems = await lintFolder(things, folder);
    expect(problems.map((p) => p.path)).toEqual([
      "cotton.md",
      "do-thing.md",
      "elm.md",
      "linen.md",
    ]);
  });

  it("gives a symbolic link its own problem, and none to the note it points at", async () => {
    const root = await mkdtemp(join(tmpdir(), "basis-lint-"));
    made.push(root);
    await mkdir(join(root, "a"));
    await mkdir(join(root, "b"));
    await writeFile(
      join(root, "a/sheets.md"),
      '---\ntype: source\ndescription: "A source."\nrole: entry\n---\n',
    );
    await symlink("../a/sheets.md", join(root, "b/sheets.md"));
    const problems = await lintFolder(things, root);
    expect(problems.map((p) => p.path)).toEqual(["b/sheets.md"]);
  });
});

const made: string[] = [];
afterEach(async () => {
  for (const root of made.splice(0))
    await rm(root, { recursive: true, force: true });
});
