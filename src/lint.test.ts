import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
      { path: "sheets.md", message: expect.stringMatching(/type/) },
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
  it("is linted with the loader's problems and the lint's, in path order", async () => {
    const folder = fileURLToPath(new URL("../fixtures/lint", import.meta.url));
    const problems = await lintFolder(things, folder);
    expect(problems.map((p) => p.path)).toEqual([
      "broken.md",
      "cotton.md",
      "do-thing.md",
      "linen.md",
    ]);
  });
});
