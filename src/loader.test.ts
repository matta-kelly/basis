import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadFolder, readNote } from "./index.ts";

const folder = fileURLToPath(new URL("../fixtures/loader", import.meta.url));

// The folders the tests make, and the paths they lock, undone after each test.
const made: string[] = [];
const locked: string[] = [];
afterEach(async () => {
  for (const path of locked.splice(0)) await chmod(path, 0o755);
  for (const root of made.splice(0))
    await rm(root, { recursive: true, force: true });
});
const lock = async (path: string) => {
  await chmod(path, 0o000);
  locked.push(path);
};

// A new folder, with the nodes written in the order given.
async function folderOf(nodes: [string, string | Buffer][]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "basis-loader-"));
  made.push(root);
  for (const [path, text] of nodes) {
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
  it("is read into its name, from the file name, its frontmatter as its fields, its body, and its source: the notes", () => {
    const text =
      '---\ntype: source\ndescription: "Where data lives."\nrole: entry\n---\nThe body.\n';
    expect(readNote("sources/slate.md", text)).toEqual({
      ok: true,
      note: {
        path: "sources/slate.md",
        name: "slate",
        fields: {
          type: "source",
          description: "Where data lives.",
          role: "entry",
        },
        body: "The body.\n",
        source: "notes",
      },
    });
  });

  it("keeps a link as the note writes it, for the schema to parse", () => {
    const read = readNote("a.md", '---\nlivesIn: ["[[slate]]"]\n---\n');
    expect(read).toMatchObject({
      note: { fields: { livesIn: ["[[slate]]"] } },
    });
  });

  it("is read with Windows line ends", () => {
    expect(readNote("a.md", "---\r\ntype: x\r\n---\r\nThe body.\r\n")).toEqual({
      ok: true,
      note: {
        path: "a.md",
        name: "a",
        fields: { type: "x" },
        body: "The body.\r\n",
        source: "notes",
      },
    });
  });

  it("has no fields when it has no frontmatter, or an empty one", () => {
    expect(readNote("a.md", "Just text.\n")).toMatchObject({
      note: { fields: {}, body: "Just text.\n" },
    });
    expect(readNote("a.md", "---\n---\nText.\n")).toMatchObject({
      note: { fields: {}, body: "Text.\n" },
    });
  });

  it("keeps its frontmatter with a BOM, or spaces after a line of ---", () => {
    for (const text of [
      "\uFEFF---\ntype: x\n---\n",
      "--- \ntype: x\n---\t\n",
    ]) {
      expect(readNote("a.md", text)).toMatchObject({
        note: { fields: { type: "x" }, body: "" },
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
  it("leaves out each path skip names, as if it were not there: a file, a folder and all in it, and a symbolic link", async () => {
    const root = await folderOf([
      ["a.md", ""],
      ["README.md", ""],
      ["code/b.md", ""],
      ["nodes/c.md", ""],
    ]);
    await symlink(join(root, "a.md"), join(root, "linked.md"));
    const skipped: string[] = [];
    const skip = (path: string) => {
      skipped.push(path);
      return ["README.md", "code", "linked.md"].includes(path);
    };
    const {
      pieces: nodes,
      problems,
      unread,
    } = await loadFolder(root, { skip });
    expect(nodes.map((note) => note.path)).toEqual(["a.md", "nodes/c.md"]);
    expect(problems).toEqual([]);
    expect(unread).toEqual([]);
    // A skipped folder is not opened, so skip is not asked about what is in it.
    expect(skipped).not.toContain("code/b.md");
    expect(skipped).toContain("nodes/c.md");
  });

  it("is read into its nodes and the problems of the nodes it cannot read, in path order, and names those nodes", async () => {
    const { pieces: nodes, problems, unread } = await loadFolder(folder);
    expect(nodes.map((note) => note.path)).toEqual([
      "empty.md",
      "loaf.md",
      "plain.md",
      "sources/slate.md",
    ]);
    expect(problems.map((problem) => problem.path)).toEqual([
      "broken.md",
      "list.md",
      "unclosed.md",
    ]);
    expect(unread).toEqual([
      { path: "broken.md", name: "broken" },
      { path: "list.md", name: "list" },
      { path: "unclosed.md", name: "unclosed" },
    ]);
  });

  it("gives each note its frontmatter as its fields, as the file has it", async () => {
    const { pieces: nodes } = await loadFolder(folder);
    expect(nodes.find((note) => note.name === "loaf")).toEqual({
      path: "loaf.md",
      name: "loaf",
      fields: {
        type: "object",
        description: "One bake of one dough. A crust.",
        key: "loaf_code",
        livesIn: ["[[slate]]", "[[daybook]]"],
        states: ["drafted", "complete", "synced", "stale"],
      },
      body: "One bake of one dough.\n",
      source: "notes",
    });
  });

  it("is in path order, however the disk lists it", async () => {
    // Read in the order the disk lists, a folder's nodes come before a note
    // named as the folder, but "a.md" sorts before "a/z.md".
    const root = await folderOf([
      ["c.md", ""],
      ["a/z.md", ""],
      ["a.md", ""],
      ["b.md", ""],
    ]);
    const { pieces: nodes } = await loadFolder(root);
    expect(nodes.map((note) => note.path)).toEqual([
      "a.md",
      "a/z.md",
      "b.md",
      "c.md",
    ]);
  });

  it("gives a problem for a note or a folder it may not open, a note that is not UTF-8, and a symbolic link, and still loads the rest", async () => {
    const root = await folderOf([
      ["a.md", ""],
      ["latin1.md", Buffer.from("---\ndescription: Caf\xe9\n---\n", "latin1")],
      ["locked.md", ""],
      ["lockeddir.md/b.md", ""],
      ["real/r.md", ""],
    ]);
    await lock(join(root, "locked.md"));
    await lock(join(root, "lockeddir.md"));
    await symlink(join(root, "a.md"), join(root, "linked.md"));
    await symlink(join(root, "real"), join(root, "linkdir"));
    const { pieces: nodes, problems, unread } = await loadFolder(root);
    expect(nodes.map((note) => note.path)).toEqual(["a.md", "real/r.md"]);
    // A symbolic link and a folder are not nodes the loader could not read.
    expect(unread).toEqual([
      { path: "latin1.md", name: "latin1" },
      { path: "locked.md", name: "locked" },
    ]);
    expect(problems.map((problem) => problem.path)).toEqual([
      "latin1.md",
      "linkdir",
      "linked.md",
      "locked.md",
      "lockeddir.md",
    ]);
  });
});
