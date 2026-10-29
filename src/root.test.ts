import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as basis from "./index.ts";

const index = JSON.stringify(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
);
const things = JSON.stringify(
  fileURLToPath(new URL("../fixtures/things.ts", import.meta.url)),
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
  const root = await mkdtemp(join(tmpdir(), "basis-root-"));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

// A config whose schema, shop, names the config's folder as its notes, with more of its defineSchema, and more of the
// config beside its schema.
const config = (schema = "", beside = "") =>
  `import { defineSchema } from ${index};\nimport things from ${things};\nconst shop = defineSchema({ name: "shop", description: "d", imports: [things], types: {}, notes: new URL("./", import.meta.url)${schema} });\nexport default { schema: shop${beside} };\n`;

describe("basis's exports", () => {
  it("give one lint, from a root, and no lint of a folder or of pieces that the caller scopes", () => {
    expect(typeof basis.lintRoot).toBe("function");
    expect(Object.keys(basis)).not.toContain("lint");
    expect(Object.keys(basis)).not.toContain("lintFolder");
  });
});

describe("lintRoot", () => {
  it("lints the graph of a root, by its config's schema, and gives its problems and its graph", async () => {
    const root = await folderOf({
      "basis.config.ts": config(),
      "slate.md": slate,
      "oven.md": oven,
    });
    const { problems, graph } = await basis.lintRoot(root);
    expect(problems.map((p) => [p.path, p.field, p.rule])).toEqual([
      ["oven.md", "/description", "basis/fields"],
    ]);
    expect(graph.all(basis.node).map((n) => n.name)).toContain("slate");
  });

  it("takes the skip and the sources of the root's schema, from its defineSchema", async () => {
    const sources = `, skip: (path) => path === "README.md", sources: [() => ({ pieces: [{ path: "code/oven.ts", name: "oven", fields: { type: "source", description: "d", role: "entry" } }], problems: [], unread: [] })]`;
    const root = await folderOf({
      "basis.config.ts": config(sources),
      "slate.md": slate,
      "README.md": "No frontmatter.\n",
    });
    const { problems, graph } = await basis.lintRoot(root);
    expect(problems).toEqual([]);
    expect(graph.all(basis.node).map((n) => n.name)).toEqual(
      expect.arrayContaining(["oven", "slate"]),
    );
  });

  it("lints a root that its schema names as its type notes", async () => {
    const root = await folderOf({
      "basis.config.ts": `import { defineSchema, defineType } from ${index};\nexport default { schema: defineSchema({ name: "buns", description: "d", types: { bun: defineType({ name: "bun", description: "d", fields: {} }) }, typeNotes: new URL("./", import.meta.url) }) };\n`,
      "bun.md": "---\ntype: type\n---\nA soft bread.\n",
    });
    expect((await basis.lintRoot(root)).problems).toEqual([]);
  });

  it("refuses a folder in node_modules, and never loads its config: it is an installed copy, linted through its import", async () => {
    const at = await folderOf({
      "node_modules/pkg/types/basis.config.js":
        'throw new Error("a config in node_modules is loaded");\n',
      "node_modules/pkg/types/bun.md": "---\ntype: type\n---\n",
    });
    const root = join(at, "node_modules", "pkg", "types");
    await expect(basis.lintRoot(root)).rejects.toThrow(
      `${root} is in node_modules: it is an installed copy, no root, and is linted only through its schema's import. Lint the root that imports it.`,
    );
  });

  it("refuses a folder with no config: a lint starts only at a root", async () => {
    const root = await folderOf({ "slate.md": slate });
    await expect(basis.lintRoot(root)).rejects.toThrow(
      `${root} is no root: a lint starts only at a root, a folder with basis.config.ts or basis.config.js.`,
    );
  });

  it("refuses a root whose schema does not name it as its notes or its type notes", async () => {
    for (const text of [
      // A schema that names no folder.
      `import things from ${things};\nexport default { schema: things };\n`,
      // A schema whose notes are another folder.
      `import { defineSchema } from ${index};\nexport default { schema: defineSchema({ name: "shop", description: "d", types: {}, notes: new URL("./below/", import.meta.url) }) };\n`,
    ]) {
      const root = await folderOf({
        "basis.config.ts": text,
        "below/slate.md": slate,
      });
      await expect(basis.lintRoot(root)).rejects.toThrow(
        /is no root of its schema: a lint starts only at the folder its schema names as its notes or its type notes/,
      );
    }
  });

  it("refuses a config that gives more than its schema: the root's schema gives its skip and sources", async () => {
    for (const beside of [
      ', skip: ["README.md"]',
      ", skip: () => true",
      ", sources: []",
      ", notes: 1",
    ]) {
      const root = await folderOf({
        "basis.config.ts": config("", beside),
        "slate.md": slate,
      });
      await expect(basis.lintRoot(root)).rejects.toThrow(
        `${join(root, "basis.config.ts")}: a config gives only its schema: export default { schema }. Give the skip and sources of the root in its schema's defineSchema.`,
      );
    }
  });
});

// Two roots side by side: target, whose own config's schema names it as its notes and gives its skip, and wrap, whose
// schema imports a schema that names target too. `named` is that schema, made in wrap's config or imported.
const roots = (named: string) => ({
  "target/schema.ts": `import { defineSchema } from ${index};\nimport things from ${things};\nexport default defineSchema({ name: "target", description: "d", imports: [things], types: {}, notes: new URL("./", import.meta.url), skip: (path) => path === "README.md" });\n`,
  "target/basis.config.ts": `import target from "./schema.ts";\nexport default { schema: target };\n`,
  "target/slate.md": slate,
  "target/README.md": "No frontmatter.\n",
  "wrap/basis.config.ts": `import { defineSchema } from ${index};\nimport things from ${things};\n${named}\nexport default { schema: defineSchema({ name: "wrap", description: "d", imports: [named], types: {}, notes: new URL("./", import.meta.url) }) };\n`,
});

describe("a folder with its own config, named by a schema the lint sees", () => {
  it("is read as the schema of its own config, alone and through an import of that schema", async () => {
    const at = await folderOf(
      roots(`import named from "../target/schema.ts";`),
    );
    expect((await basis.lintRoot(join(at, "target"))).problems).toEqual([]);
    const { problems, graph } = await basis.lintRoot(join(at, "wrap"));
    expect(problems).toEqual([]);
    expect(graph.all(basis.node).map((n) => n.name)).toContain("slate");
  });

  it("is refused when the schema that names it, as its notes or its type notes, is not its config's", async () => {
    for (const [field, as] of [
      ["notes", "notes"],
      ["typeNotes", "type notes"],
    ]) {
      const at = await folderOf(
        roots(
          `const named = defineSchema({ name: "picked", description: "d", imports: [things], types: {}, ${field}: new URL("../target/", import.meta.url), skip: () => true });`,
        ),
      );
      await expect(basis.lintRoot(join(at, "wrap"))).rejects.toThrow(
        `${join(at, "target")} holds its own config, so it is read only as its config's schema, target, reads it: the schema picked, which names it as its ${as}, is another. Import its config's schema, one copy of it, or name another folder.`,
      );
    }
  });
});

// target, a root whose own config's schema names it as its notes, and wrap, whose schema imports picked: a schema that
// names target/sub/, a folder with no config in target's ground, as its notes or its type notes.
const nested = (field: string) => ({
  "target/basis.config.ts": `import { defineSchema } from ${index};\nimport things from ${things};\nexport default { schema: defineSchema({ name: "target", description: "d", imports: [things], types: {}, notes: new URL("./", import.meta.url) }) };\n`,
  "target/slate.md": slate,
  "target/sub/bad.md": "---\ntype: nothing\n---\n",
  "wrap/basis.config.ts": `import { defineSchema } from ${index};\nimport things from ${things};\nconst picked = defineSchema({ name: "picked", description: "d", imports: [things], types: {}, ${field}: new URL("../target/sub/", import.meta.url), skip: () => true });\nexport default { schema: defineSchema({ name: "wrap", description: "d", imports: [picked], types: {}, notes: new URL("./", import.meta.url) }) };\n`,
});

describe("a folder with no config, named by a schema the lint sees", () => {
  it("is refused when another root's ground holds it, as the notes or the type notes of a schema that is not that root's", async () => {
    for (const [field, as] of [
      ["notes", "notes"],
      ["typeNotes", "type notes"],
    ] as const) {
      const at = await folderOf(nested(field));
      await expect(basis.lintRoot(join(at, "wrap"))).rejects.toThrow(
        `${join(at, "target", "sub")} is in the ground of the root ${join(at, "target")}, whose config's schema is target: the schema picked, which names it as its ${as}, is another, so its notes would be read one way here and another in that root's lint. Name a folder that no other root's ground holds, or give this one a config of its own.`,
      );
    }
  });

  it("is read when the root whose ground holds it is its own schema's", async () => {
    const root = await folderOf({
      "basis.config.ts": `import { defineSchema, defineType } from ${index};\nexport default { schema: defineSchema({ name: "buns", description: "d", types: { bun: defineType({ name: "bun", description: "d", fields: {} }) }, notes: new URL("./", import.meta.url), typeNotes: new URL("./types/", import.meta.url) }) };\n`,
      "types/bun.md": "---\ntype: type\n---\nA soft bread.\n",
    });
    expect((await basis.lintRoot(root)).problems).toEqual([]);
  });
});

// A root whose schema imports pkg, a package installed in the root's node_modules, whose type notes it ships with no
// config, as a package that leaves its config out of its files does.
const installed = {
  "node_modules/pkg/schema.js": `import { defineSchema, defineType } from ${index};\nexport default defineSchema({ name: "pkg", description: "d", types: { bun: defineType({ name: "bun", description: "d", fields: {} }) }, typeNotes: new URL("./types/", import.meta.url) });\n`,
  "node_modules/pkg/types/bun.md": "---\ntype: type\n---\nA soft bread.\n",
  "basis.config.ts": `import { defineSchema } from ${index};\nimport pkg from "./node_modules/pkg/schema.js";\nexport default { schema: defineSchema({ name: "shop", description: "d", imports: [pkg], types: {}, notes: new URL("./", import.meta.url) }) };\n`,
  "bread.md": "---\ntype: bun\ndescription: d\n---\n",
};

describe("node_modules, in no graph's ground", () => {
  it("holds an installed package's type notes, read only through its schema's import", async () => {
    const root = await folderOf(installed);
    const { problems, graph } = await basis.lintRoot(root);
    expect(problems).toEqual([]);
    expect(graph.all(basis.node).map((n) => [n.name, n.type])).toEqual(
      expect.arrayContaining([
        ["bread", "bun"],
        ["bun", "type"],
      ]),
    );
  });

  it("holds no root: an installed package that ships a config is read through its import, and its config is never loaded", async () => {
    for (const name of ["basis.config.ts", "basis.config.js"]) {
      const root = await folderOf({
        ...installed,
        [`node_modules/pkg/types/${name}`]:
          'throw new Error("a config in node_modules is loaded");\n',
        "node_modules/pkg/types/sub/bad.md": "---\ntype: nothing\n---\n",
      });
      const { problems, graph } = await basis.lintRoot(root);
      expect(problems).toEqual([]);
      expect(graph.all(basis.node).map((n) => [n.name, n.type])).toEqual(
        expect.arrayContaining([
          ["bread", "bun"],
          ["bun", "type"],
        ]),
      );
    }
  });

  it("holds no note of the root's: the walk of a ground never enters a folder named node_modules", async () => {
    const root = await folderOf({
      ...installed,
      "node_modules/stray/bad.md": "---\ntype: nothing\n---\n",
      "notes/node_modules/bad.md": "---\ntype: nothing\n---\n",
    });
    const { problems, graph } = await basis.lintRoot(root);
    expect(problems).toEqual([]);
    expect(graph.all(basis.node).map((n) => n.name)).not.toContain("bad");
  });
});
