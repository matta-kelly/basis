import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "./index.ts";

const things = fileURLToPath(new URL("../fixtures/things.ts", import.meta.url));
const slate =
  '---\ntype: source\ndescription: "Where each bake is written."\nrole: entry\n---\n';
const oven = "---\ntype: source\nrole: entry\n---\n";

// The folders the tests make, undone after each test.
const made: string[] = [];
afterEach(async () => {
  for (const root of made.splice(0))
    await rm(root, { recursive: true, force: true });
});

// A new folder, with the files given.
async function folderOf(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "basis-cli-"));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

// A config with the bakery's schema, and the skip given as code.
const config = (skip?: string) =>
  `import things from ${JSON.stringify(things)};\nexport default { schema: things${skip ? `, skip: ${skip}` : ""} };\n`;

// The command, run, with what it wrote.
async function cli(args: string[], cwd: string) {
  const log: string[] = [];
  const error: string[] = [];
  const code = await run(args, cwd, {
    log: (line) => log.push(line),
    error: (line) => error.push(line),
  });
  return { code, log, error };
}

describe("basis lint", () => {
  it("gives 0 and writes nothing when every note fits", async () => {
    const root = await folderOf({
      "basis.config.ts": config(),
      "slate.md": slate,
    });
    expect(await cli(["lint"], root)).toEqual({ code: 0, log: [], error: [] });
  });

  it("gives 1 and a line for each problem, by path, when a note does not fit", async () => {
    const root = await folderOf({
      "basis.config.ts": config(),
      "slate.md": slate,
      "oven.md": oven,
    });
    const { code, log, error } = await cli(["lint"], root);
    expect(code).toBe(1);
    expect(log).toEqual([expect.stringMatching(/^oven\.md: description: /)]);
    expect(error).toEqual([]);
  });

  it("checks the folder it is given, from the folder it runs in", async () => {
    const root = await folderOf({
      "notes/basis.config.ts": config(),
      "notes/oven.md": oven,
    });
    const { code, log } = await cli(["lint", "notes"], root);
    expect(code).toBe(1);
    // By its path from the folder the command runs in, so it opens as given.
    expect(log).toEqual([expect.stringMatching(/^notes\/oven\.md: /)]);
  });

  it("leaves out each path its skip names, with all in it, and only that path", async () => {
    const root = await folderOf({
      "basis.config.ts": config('["./code/", "README.md"]'),
      "slate.md": slate,
      "README.md": "No frontmatter.\n",
      "code/notes.md": "No frontmatter.\n",
      "codebook.md": "No frontmatter.\n",
    });
    const { code, log } = await cli(["lint"], root);
    expect(code).toBe(1);
    expect(log).toEqual([expect.stringMatching(/^codebook\.md: /)]);
  });

  it("takes a skip that is a function", async () => {
    const root = await folderOf({
      "basis.config.ts": config('(path) => path.startsWith("code")'),
      "slate.md": slate,
      "code/notes.md": "No frontmatter.\n",
    });
    expect((await cli(["lint"], root)).code).toBe(0);
  });

  it("reads basis.config.js when there is no basis.config.ts", async () => {
    const root = await folderOf({
      "basis.config.js": config(),
      "oven.md": oven,
    });
    expect((await cli(["lint"], root)).code).toBe(1);
  });

  it("gives 2 and names the config it looks for when there is none", async () => {
    const root = await folderOf({ "slate.md": slate });
    const { code, log, error } = await cli(["lint"], root);
    expect(code).toBe(2);
    expect(log).toEqual([]);
    expect(error).toEqual([
      `${root} has no config: basis lint reads basis.config.ts or basis.config.js.`,
    ]);
  });

  it("gives 2 and names the config when it cannot be loaded, or is not a config", async () => {
    for (const text of [
      "throw new Error('broken');\n",
      "export default 1;\n",
      "export default { schema: {} };\n",
      `${config('"code"')}`,
    ]) {
      const root = await folderOf({ "basis.config.ts": text });
      const { code, error } = await cli(["lint"], root);
      expect(code).toBe(2);
      expect(error).toEqual([
        expect.stringContaining(join(root, "basis.config.ts")),
      ]);
    }
  });

  it("gives 2 when the schema of the config does not hold, which only the lint finds", async () => {
    const root = await folderOf({
      "basis.config.ts":
        'export default { schema: { name: "Not A Name", description: "d", types: {}, imports: [] } };\n',
      "slate.md": slate,
    });
    const { code, log, error } = await cli(["lint"], root);
    expect(code).toBe(2);
    expect(log).toEqual([]);
    expect(error).toEqual([
      expect.stringMatching(new RegExp(`^${root} cannot be checked: `)),
    ]);
  });

  it("gives 2 for a folder that is not there", async () => {
    const root = await folderOf({});
    const { code, error } = await cli(["lint", "missing"], root);
    expect(code).toBe(2);
    expect(error).toEqual([expect.stringContaining(join(root, "missing"))]);
  });

  it("gives 2 and its usage for a command it does not know, and 0 for help", async () => {
    const root = await folderOf({});
    for (const args of [[], ["check"], ["lint", "a", "b"]])
      expect(await cli(args, root)).toEqual({
        code: 2,
        log: [],
        error: ["Usage: basis lint [folder]"],
      });
    for (const args of [["--help"], ["-h"], ["lint", "--help"]])
      expect(await cli(args, root)).toEqual({
        code: 0,
        log: ["Usage: basis lint [folder]"],
        error: [],
      });
  });
});
