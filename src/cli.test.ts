import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fixture } from "../fixtures/notes.ts";
import { run } from "./index.ts";

const things = fileURLToPath(new URL("../fixtures/things.ts", import.meta.url));
const index = JSON.stringify(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
);
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

// A config whose schema, shop, imports the bakery's and names the config's folder as its notes, with more of its
// defineSchema given as code, and more of the config beside its schema.
const config = (schema = "", beside = "") =>
  `import { defineSchema } from ${index};\nimport things from ${JSON.stringify(things)};\nconst shop = defineSchema({ name: "shop", description: "d", imports: [things], types: {}, notes: new URL("./", import.meta.url)${schema} });\nexport default { schema: shop${beside} };\n`;

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
    expect(log).toEqual([
      expect.stringMatching(
        /^oven\.md: \/description: Missing: .* \(basis\/fields\)$/,
      ),
    ]);
    expect(error).toEqual([]);
  });

  it("gives a type note's problem by its path from the folder it runs in, outside the folder it lints", async () => {
    const kitchen = fileURLToPath(
      new URL("../fixtures/kitchen.ts", import.meta.url),
    );
    const root = await folderOf({
      "basis.config.ts": `import { defineSchema } from ${index};\nimport kitchen from ${JSON.stringify(kitchen)};\nexport default { schema: defineSchema({ name: "shop", description: "d", imports: [kitchen], types: {}, notes: new URL("./", import.meta.url) }) };\n`,
    });
    const bun = fileURLToPath(fixture("types/kitchen/bun.md"));
    const { code, log } = await cli(["lint"], root);
    expect(code).toBe(1);
    expect(log).toContain(
      `${relative(root, bun)}: The type bun of kitchen has no type note: make this note, of type type, and say in its body what bun is for. (basis/type-note)`,
    );
  });

  it("lints the notes of each schema its config's schema imports, from that schema's own folder", async () => {
    const pkg = `import { defineSchema } from ${JSON.stringify(fileURLToPath(new URL("./index.ts", import.meta.url)))};\nimport things from ${JSON.stringify(things)};\nexport default defineSchema({ name: "pkg", description: "d", imports: [things], types: {}, notes: new URL("./", import.meta.url) });\n`;
    const root = await folderOf({
      "pkg/schema.ts": pkg,
      "pkg/oven.md": oven,
      "shop/basis.config.ts": `import { defineSchema } from ${JSON.stringify(fileURLToPath(new URL("./index.ts", import.meta.url)))};\nimport pkg from "../pkg/schema.ts";\nexport default { schema: defineSchema({ name: "shop", description: "d", imports: [pkg], types: {}, notes: new URL("./", import.meta.url) }) };\n`,
      "shop/slate.md": slate,
    });
    const { code, log } = await cli(["lint", "shop"], root);
    expect(code).toBe(1);
    expect(log).toEqual([
      expect.stringMatching(
        /^pkg\/oven\.md: \/description: Missing: .* \(basis\/fields\)$/,
      ),
    ]);
  });

  it("gives 2 when its config gives more than its schema: the root's schema gives its skip and sources", async () => {
    for (const beside of [', skip: ["README.md"]', ", sources: []"]) {
      const root = await folderOf({
        "basis.config.ts": config("", beside),
        "slate.md": slate,
      });
      const { code, log, error } = await cli(["lint"], root);
      expect({ code, log }).toEqual({ code: 2, log: [] });
      expect(error).toEqual([
        `${join(root, "basis.config.ts")}: a config gives only its schema: export default { schema }. Give the skip and sources of the root in its schema's defineSchema.`,
      ]);
    }
  });

  it("gives 2 when the folder is no root of its config's schema: its schema names it as neither its notes nor its type notes", async () => {
    const root = await folderOf({
      "basis.config.ts": `import things from ${JSON.stringify(things)};\nexport default { schema: things };\n`,
      "slate.md": slate,
    });
    const { code, log, error } = await cli(["lint"], root);
    expect({ code, log }).toEqual({ code: 2, log: [] });
    expect(error).toEqual([
      expect.stringContaining(
        `${root} is no root of its schema: a lint starts only at the folder its schema names as its notes or its type notes`,
      ),
    ]);
  });

  it("gives 2 when a schema it sees names a folder with its own config, and is not that config's schema", async () => {
    const at = await folderOf({
      "target/basis.config.ts": config(),
      "target/slate.md": slate,
      "wrap/basis.config.ts": `import { defineSchema } from ${index};\nconst picked = defineSchema({ name: "picked", description: "d", types: {}, notes: new URL("../target/", import.meta.url), skip: () => true });\nexport default { schema: defineSchema({ name: "wrap", description: "d", imports: [picked], types: {}, notes: new URL("./", import.meta.url) }) };\n`,
    });
    const { code, log, error } = await cli(["lint", "wrap"], at);
    expect({ code, log }).toEqual({ code: 2, log: [] });
    expect(error).toEqual([
      `${join(at, "target")} holds its own config, so it is read only as its config's schema, shop, reads it: the schema picked, which names it as its notes, is another. Import its config's schema, one copy of it, or name another folder.`,
    ]);
  });

  it("gives 2 when a schema it sees names a folder with no config in another root's ground, and is not that root's schema", async () => {
    const at = await folderOf({
      "target/basis.config.ts": config(),
      "target/sub/slate.md": slate,
      "wrap/basis.config.ts": `import { defineSchema } from ${index};\nconst picked = defineSchema({ name: "picked", description: "d", types: {}, typeNotes: new URL("../target/sub/", import.meta.url) });\nexport default { schema: defineSchema({ name: "wrap", description: "d", imports: [picked], types: {}, notes: new URL("./", import.meta.url) }) };\n`,
    });
    const { code, log, error } = await cli(["lint", "wrap"], at);
    expect({ code, log }).toEqual({ code: 2, log: [] });
    expect(error).toEqual([
      `${join(at, "target", "sub")} is in the ground of the root ${join(at, "target")}, whose config's schema is shop: the schema picked, which names it as its type notes, is another, so its notes would be read one way here and another in that root's lint. Name a folder that no other root's ground holds, or give this one a config of its own.`,
    ]);
  });

  it("checks the folder it is given, from the folder it runs in", async () => {
    const root = await folderOf({
      "notes/basis.config.ts": config(),
      "notes/oven.md": oven,
    });
    const { code, log } = await cli(["lint", "notes"], root);
    expect(code).toBe(1);
    // By its path from the folder the command runs in, so it opens as given.
    expect(log).toEqual([
      expect.stringMatching(
        /^notes\/oven\.md: \/description: Missing: .* \(basis\/fields\)$/,
      ),
    ]);
  });

  it("leaves out each path the skip of its schema leaves out", async () => {
    const root = await folderOf({
      "basis.config.ts": config(', skip: (path) => path.startsWith("code")'),
      "slate.md": slate,
      "code/notes.md": "No frontmatter.\n",
    });
    expect((await cli(["lint"], root)).code).toBe(0);
  });

  it("lints the pieces of each source its schema names, with the root's notes", async () => {
    // A node of code that links to the note slate, and one that does not fit its type.
    const sources = `[() => ({ pieces: [{ path: "code/loaf.ts", name: "loaf", fields: { type: "object", description: "A bake.", key: "k", states: ["drafted"], livesIn: ["slate"] } }, { path: "code/oven.ts", name: "oven", fields: { type: "source" } }], problems: [], unread: [] })]`;
    const root = await folderOf({
      "basis.config.ts": config(`, sources: ${sources}`),
      "slate.md": slate,
    });
    expect(await cli(["lint"], root)).toEqual({
      code: 1,
      log: [
        "code/oven.ts: /description: Missing: its type needs a string here. (basis/fields)",
        'code/oven.ts: /role: Missing: its type needs one of "entry", "record", "projection" here. (basis/fields)',
      ],
      error: [],
    });
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
      `${root} is no root: a lint starts only at a root, a folder with basis.config.ts or basis.config.js.`,
    ]);
  });

  it("gives 2 and names the config it looks for when a folder has a config's name: a config is a file", async () => {
    const root = await folderOf({
      "basis.config.ts/keep.txt": "",
      "slate.md": slate,
    });
    const { code, log, error } = await cli(["lint"], root);
    expect(code).toBe(2);
    expect(log).toEqual([]);
    expect(error).toEqual([
      `${root} is no root: a lint starts only at a root, a folder with basis.config.ts or basis.config.js.`,
    ]);
  });

  it("gives 2 and names the config when it cannot be loaded, or is not a config", async () => {
    for (const text of [
      "throw new Error('broken');\n",
      "export default 1;\n",
      "export default { schema: {} };\n",
      config("", ', skip: "code"'),
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
        'export default { schema: { name: "Not A Name", description: "d", types: {}, imports: [], notes: new URL("./", import.meta.url) } };\n',
      "slate.md": slate,
    });
    const { code, log, error } = await cli(["lint"], root);
    expect(code).toBe(2);
    expect(log).toEqual([]);
    expect(error).toEqual([
      expect.stringMatching(new RegExp(`^${root} cannot be checked: `)),
    ]);
  });

  it("gives 2 for a folder in node_modules: an installed copy is linted through its import", async () => {
    const at = await folderOf({
      "node_modules/pkg/basis.config.ts": config(),
      "node_modules/pkg/slate.md": slate,
    });
    const { code, log, error } = await cli(["lint", "node_modules/pkg"], at);
    expect({ code, log }).toEqual({ code: 2, log: [] });
    expect(error).toEqual([
      `${join(at, "node_modules", "pkg")} is in node_modules: it is an installed copy, no root, and is linted only through its schema's import. Lint the root that imports it.`,
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
        error: ["Usage: basis lint [root]"],
      });
    for (const args of [["--help"], ["-h"], ["lint", "--help"]])
      expect(await cli(args, root)).toEqual({
        code: 0,
        log: ["Usage: basis lint [root]"],
        error: [],
      });
  });
});
