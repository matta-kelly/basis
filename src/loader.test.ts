import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFolder, readNote } from "./index.ts";

const folder = fileURLToPath(new URL("../fixtures/loader", import.meta.url));

// A new folder, with the notes written in the order given.
async function folderOf(notes: [string, string][]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "basis-loader-"));
  for (const [path, text] of notes) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

// YAML whose aliases expand to 10^5 items.
const aliasBomb = [
  "a: &a [x, x, x, x, x, x, x, x, x, x]",
  ...["b", "c", "d", "e"].map(
    (name, i) =>
      `${name}: &${name} [${Array(10).fill(`*${"abcd"[i]}`).join(", ")}]`,
  ),
].join("\n");

describe("a note", () => {
  it("is read into its name, from the file name, its frontmatter and its body", () => {
    const text =
      '---\ntype: source\ndescription: "Where data lives."\nrole: entry\n---\nThe body.\n';
    expect(readNote("sources/sheets.md", text)).toEqual({
      ok: true,
      note: {
        path: "sources/sheets.md",
        name: "sheets",
        frontmatter: {
          type: "source",
          description: "Where data lives.",
          role: "entry",
        },
        body: "The body.\n",
      },
    });
  });

  it("keeps a link as the note writes it, for the package to parse", () => {
    const read = readNote("a.md", '---\nlivesIn: ["[[sheets]]"]\n---\n');
    expect(read).toMatchObject({
      note: { frontmatter: { livesIn: ["[[sheets]]"] } },
    });
  });

  it("is read with Windows line ends", () => {
    expect(readNote("a.md", "---\r\ntype: x\r\n---\r\nThe body.\r\n")).toEqual({
      ok: true,
      note: {
        path: "a.md",
        name: "a",
        frontmatter: { type: "x" },
        body: "The body.\r\n",
      },
    });
  });

  it("has an empty frontmatter when it has none, or an empty one", () => {
    expect(readNote("a.md", "Just text.\n")).toMatchObject({
      note: { frontmatter: {}, body: "Just text.\n" },
    });
    expect(readNote("a.md", "---\n---\nText.\n")).toMatchObject({
      note: { frontmatter: {}, body: "Text.\n" },
    });
  });

  it("keeps its frontmatter with a BOM, or spaces after a line of ---", () => {
    for (const text of [
      "\uFEFF---\ntype: x\n---\n",
      "--- \ntype: x\n---\t\n",
    ]) {
      expect(readNote("a.md", text)).toMatchObject({
        note: { frontmatter: { type: "x" }, body: "" },
      });
    }
  });

  it("is a problem, with its path, when its frontmatter cannot be read", () => {
    for (const text of [
      `---\n${aliasBomb}\n---\n`,
      "---\nlivesIn: [unclosed\n---\n",
      "---\ntype: x\nNo closing line.\n",
      "---\n- a\n- b\n---\n",
      "---\ntype: x\ntype: y\n---\n",
    ]) {
      expect(readNote("a.md", text)).toMatchObject({
        ok: false,
        problem: { path: "a.md", message: expect.any(String) },
      });
    }
  });
});

describe("a folder", () => {
  it("is read into its notes and the problems of the notes it cannot read, in path order", async () => {
    const { notes, problems } = await loadFolder(folder);
    expect(notes.map((note) => note.path)).toEqual([
      "empty.md",
      "fabric.md",
      "plain.md",
      "sources/sheets.md",
    ]);
    expect(problems.map((problem) => problem.path)).toEqual([
      "broken.md",
      "list.md",
      "unclosed.md",
    ]);
  });

  it("gives each note its frontmatter as the file has it", async () => {
    const { notes } = await loadFolder(folder);
    expect(notes.find((note) => note.name === "fabric")).toEqual({
      path: "fabric.md",
      name: "fabric",
      frontmatter: {
        type: "object",
        description: "One print on one cloth. A swatch.",
        key: "fabric_code",
        livesIn: ["[[sheets]]", "[[warehouse]]"],
        states: ["drafted", "complete", "synced", "stale"],
      },
      body: "One print on one cloth.\n",
    });
  });

  it("is in path order, however the disk lists it", async () => {
    // Read in the order the disk lists, a folder's notes come before a note
    // named as the folder, but "a.md" sorts before "a/z.md".
    const root = await folderOf([
      ["c.md", ""],
      ["a/z.md", ""],
      ["a.md", ""],
      ["b.md", ""],
    ]);
    const { notes } = await loadFolder(root);
    expect(notes.map((note) => note.path)).toEqual([
      "a.md",
      "a/z.md",
      "b.md",
      "c.md",
    ]);
  });

  it("gives a problem for a note it may not open, and for a symbolic link, and still loads the rest", async () => {
    const root = await folderOf([
      ["a.md", ""],
      ["locked.md", ""],
      ["real/r.md", ""],
    ]);
    await chmod(join(root, "locked.md"), 0o000);
    await symlink(join(root, "a.md"), join(root, "linked.md"));
    await symlink(join(root, "real"), join(root, "linkdir"));
    const { notes, problems } = await loadFolder(root);
    expect(notes.map((note) => note.path)).toEqual(["a.md", "real/r.md"]);
    expect(problems.map((problem) => problem.path)).toEqual([
      "linkdir",
      "linked.md",
      "locked.md",
    ]);
  });
});
