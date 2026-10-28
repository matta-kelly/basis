// The contract of a problem: { path, rule?, field?, message }, checked over every kind of problem basis gives, and
// against SARIF 2.1.0's own schema (fixtures/sarif-schema-2.1.0.json, from oasis-tcs/sarif-spec).
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ajvDraft04 from "ajv-draft-04";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import kitchen from "../fixtures/kitchen.ts";
import things, { object, source } from "../fixtures/things.ts";
import {
  coreRules,
  defineRule,
  defineSchema,
  defineType,
  lint,
  lintFolder,
  type Note,
  type Problem,
} from "./index.ts";

const note = (path: string, fields: Record<string, unknown>): Note => ({
  path,
  name: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  fields,
  body: "",
  source: "notes",
});

const fixture = (path: string) =>
  fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url));

const ledger = note("ledger.md", {
  type: "source",
  description: "The books.",
  role: "record",
});
const loaf = {
  type: "object",
  description: "One bake.",
  key: "loaf_code",
  livesIn: ["[[ledger]]"],
  states: ["drafted"],
};

const stamp = defineType({
  name: "stamp",
  description: "A mark with a code.",
  fields: { code: z.string() },
  key: ["code"],
});
const grain = defineType({
  name: "grain",
  description: "d",
  abstract: true,
  fields: {},
});
const inRecord = defineRule({
  name: "in-record",
  description: "An object lives in at least one source of record.",
  on: object,
  check: (node, graph) =>
    node.livesIn.some((name) => graph.get(name, source)?.role === "record")
      ? []
      : [{ field: "/livesIn", message: "No source it lives in is a record." }],
});
const shop = defineSchema({
  name: "shop",
  description: "things, with a keyed type, an abstract type and a rule.",
  imports: [things],
  types: { stamp, grain },
  typeNotes: new URL("../fixtures/types/shop/", import.meta.url),
  rules: [inRecord],
});

// One note, or more, for each rule basis has, and one for a schema's rule.
const notes = [
  ledger,
  note("Loaf.md", { ...loaf, key: "a" }),
  note("named.md", { ...loaf, key: "b", name: "named" }),
  note("a/twin.md", { ...loaf, key: "c" }),
  note("b/twin.md", { ...loaf, key: "d" }),
  note("untyped.md", { description: "d" }),
  note("stranger.md", { type: "ghost", description: "d" }),
  note("abstract.md", { type: "grain", description: "d" }),
  note("short.md", { ...loaf, key: "e", states: [] }),
  note("extra.md", { ...loaf, key: "f", colour: "brown" }),
  note("nested.md", { ...loaf, key: "g", states: ["drafted", "Done"] }),
  note("lost.md", { ...loaf, key: "h", livesIn: ["[[nowhere]]"] }),
  note("wrong.md", { ...loaf, key: "i", livesIn: ["[[short]]"] }),
  note("one.md", { type: "stamp", description: "d", code: "x" }),
  note("two.md", { type: "stamp", description: "d", code: "x" }),
  note("slashed.md", { ...loaf, key: "j", "a/b~c": 1 }),
  note("bare.md", { type: "source", role: "record" }),
];

// A piece from code of the node bare, which gives the field its note gives too.
const bareInCode = {
  path: "code/bare.ts",
  name: "bare",
  source: "1",
  fields: { type: "source", role: "record" },
};

/** A folder with a symbolic link, a file that cannot be read, and a folder that cannot be read. */
async function unreadable(): Promise<Problem[]> {
  const root = await mkdtemp(join(tmpdir(), "basis-problems-"));
  try {
    await writeFile(join(root, "shut.md"), "---\ntype: source\n---\n");
    await chmod(join(root, "shut.md"), 0o000);
    await mkdir(join(root, "closed"));
    await chmod(join(root, "closed"), 0o000);
    await symlink("shut.md", join(root, "link.md"));
    return (await lintFolder(things, root)).problems;
  } finally {
    await chmod(join(root, "shut.md"), 0o644);
    await chmod(join(root, "closed"), 0o755);
    await rm(root, { recursive: true, force: true });
  }
}

/** Every problem the fixtures give: the in-memory lint, type notes, notes that cannot be read, and a folder. */
async function everyProblem(): Promise<Problem[]> {
  return [
    ...(await unreadable()),
    ...lint(shop, [...notes, bareInCode]).problems,
    ...(await lintFolder(kitchen, fixture("types"))).problems,
    ...(await lintFolder(things, fixture("loader"))).problems,
    ...(await lintFolder(things, fixture("lint"))).problems,
    ...(await lintFolder(exporting, fixture("lint"))).problems,
  ];
}

// A schema whose exports give a zod object that no type defines.
const exporting = defineSchema({
  name: "exporting",
  description: "d",
  imports: [things],
  types: {},
  exports: () => ({ Stray: z.object({ name: z.string() }) }),
});

const coreIds = coreRules.map((rule) => rule.id);

describe("a problem", () => {
  it("has a rule from basis's closed list, or of the form <schema>/<rule>, or none when its note cannot be read", async () => {
    const problems = await everyProblem();
    for (const problem of problems) {
      // No rule if and only if fatal: a path that cannot be read as a note.
      expect(problem.rule === undefined).toBe(problem.fatal === true);
      if (problem.rule === undefined) {
        expect(problem.field).toBeUndefined();
        continue;
      }
      expect(
        coreIds.includes(problem.rule as never) ||
          /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(problem.rule),
      ).toBe(true);
      if (problem.rule.startsWith("basis/"))
        expect(coreIds).toContain(problem.rule);
    }
    // Each rule of basis's list is given by some fixture, a schema's rule is too, and so is a note that cannot be read.
    const given = new Set(problems.map((problem) => problem.rule));
    for (const id of coreIds) expect(given).toContain(id);
    expect(given).toContain("shop/in-record");
    expect(given).toContain(undefined);
    // Each kind of path that cannot be read is fatal: a symbolic link, a file and a folder that cannot be read.
    const fatal = problems
      .filter((problem) => problem.fatal)
      .map((p) => p.message);
    for (const start of [
      "A symbolic link",
      "The file cannot be read",
      "The folder cannot be read",
    ])
      expect(fatal.some((message) => message.startsWith(start))).toBe(true);
  });

  it("has only the keys of the contract", async () => {
    for (const problem of await everyProblem())
      for (const key of Object.keys(problem))
        expect(["path", "rule", "field", "message", "fatal"]).toContain(key);
  });

  it("names the field it is in, and its message does not say it again", () => {
    const at = (path: string) =>
      lint(shop, notes).problems.filter((problem) => problem.path === path);
    expect(at("short.md")).toEqual([
      {
        path: "short.md",
        rule: "basis/fields",
        field: "/states",
        message: "Too small: expected array to have >=1 items",
      },
    ]);
    expect(at("nested.md")).toEqual([
      {
        path: "nested.md",
        rule: "basis/fields",
        field: "/states/1",
        message: "Not a lowercase slug.",
      },
    ]);
    expect(at("extra.md")).toEqual([
      {
        path: "extra.md",
        rule: "basis/fields",
        field: "/colour",
        message: "Not a field of its type: remove it, or add it to the type.",
      },
    ]);
    expect(at("lost.md")).toEqual([
      {
        path: "lost.md",
        rule: "basis/link",
        field: "/livesIn",
        message: "It points at nowhere, which is not a node.",
      },
      {
        path: "lost.md",
        rule: "shop/in-record",
        field: "/livesIn",
        message: "No source it lives in is a record.",
      },
    ]);
    expect(at("named.md")).toEqual([
      {
        path: "named.md",
        rule: "basis/name",
        field: "/name",
        message:
          "Its name is not one of its fields. A note's name is its file name. Remove it.",
      },
    ]);
    expect(at("untyped.md")).toEqual([
      {
        path: "untyped.md",
        rule: "basis/type",
        field: "/type",
        message: "The node has no type.",
      },
    ]);
  });

  it("names no field when the problem is the whole note, and the field of a key of one field", () => {
    const at = (path: string) =>
      lint(shop, notes).problems.filter((problem) => problem.path === path);
    expect(at("Loaf.md")).toEqual([
      {
        path: "Loaf.md",
        rule: "basis/name",
        message:
          "The name Loaf is not a lowercase slug. A note's name is its file name.",
      },
    ]);
    expect(at("a/twin.md")).toEqual([
      {
        path: "a/twin.md",
        rule: "basis/unique-name",
        message: "The name twin is also the name of b/twin.md.",
      },
    ]);
    expect(at("one.md")).toEqual([
      {
        path: "one.md",
        rule: "basis/key",
        field: "/code",
        message:
          'The key code "x" of the type stamp is also the key of two.md.',
      },
    ]);
  });

  it("names a field as a JSON Pointer, with ~ and / in a key escaped, and says a missing field is missing", () => {
    const at = (path: string) =>
      lint(shop, notes).problems.filter((problem) => problem.path === path);
    expect(at("slashed.md")).toEqual([
      {
        path: "slashed.md",
        rule: "basis/fields",
        field: "/a~1b~0c",
        message: "Not a field of its type: remove it, or add it to the type.",
      },
    ]);
    expect(at("bare.md")).toEqual([
      {
        path: "bare.md",
        rule: "basis/fields",
        field: "/description",
        message: "Missing: its type needs a string here.",
      },
    ]);
  });

  it("has no rule and no field when its note cannot be read", async () => {
    const unread = (
      await lintFolder(things, fixture("loader"))
    ).problems.filter((problem) => problem.rule === undefined);
    expect(unread.length).toBeGreaterThan(0);
    for (const problem of unread) expect(problem.field).toBeUndefined();
  });

  it("is a SARIF 2.1.0 result, in a log the official schema accepts", async () => {
    const schema = JSON.parse(
      await readFile(fixture("sarif-schema-2.1.0.json"), "utf8"),
    ) as object;
    const validate = new ajvDraft04.default({ strict: false }).compile(schema);
    const problems = await everyProblem();
    const log = {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "basis",
              rules: coreRules.map(({ id, description }) => ({
                id,
                shortDescription: { text: description },
              })),
            },
            // A schema's rules come from a plugin of the tool: one toolComponent for each schema.
            extensions: [
              {
                name: "shop",
                rules: [
                  {
                    id: "shop/in-record",
                    shortDescription: { text: inRecord.description },
                  },
                ],
              },
            ],
          },
          // A note that cannot be read is a notification of the tool, not a result.
          invocations: [
            {
              executionSuccessful: true,
              toolExecutionNotifications: problems
                .filter((problem) => problem.rule === undefined)
                .map((problem) => ({
                  level: "error",
                  message: { text: problem.message },
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri: problem.path },
                      },
                    },
                  ],
                })),
            },
          ],
          results: problems
            .filter((problem) => problem.rule !== undefined)
            .map((problem) => ({
              ruleId: problem.rule,
              ...(problem.rule?.startsWith("shop/") && {
                rule: { id: problem.rule, toolComponent: { name: "shop" } },
              }),
              level: "error",
              message: { text: problem.message },
              locations: [
                {
                  physicalLocation: { artifactLocation: { uri: problem.path } },
                  ...(problem.field && {
                    logicalLocations: [
                      { fullyQualifiedName: problem.field, kind: "property" },
                    ],
                  }),
                },
              ],
            })),
        },
      ],
    };
    expect(validate(log), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("basis's rules", () => {
  it("are a closed list of ids of the built-in schema, each kebab-case with a description", () => {
    expect(coreIds).toEqual([
      "basis/name",
      "basis/unique-name",
      "basis/merge",
      "basis/type",
      "basis/fields",
      "basis/link",
      "basis/key",
      "basis/type-note",
      "basis/type-note-type",
      "basis/type-note-folder",
      "basis/one-definition",
    ]);
    for (const rule of coreRules) expect(rule.description).not.toBe("");
    expect(Object.isFrozen(coreRules)).toBe(true);
  });
});

describe("a rule's report", () => {
  const reporting = (name: string, check: () => unknown) =>
    defineSchema({
      name,
      description: "d",
      imports: [things],
      types: {},
      rules: [
        defineRule({
          name: "report",
          description: "d",
          on: object,
          check: check as never,
        }),
      ],
    });

  it("gives a problem with the rule's id and no field when it names none", () => {
    expect(
      lint(
        reporting("plain", () => [{ message: "Wrong." }]),
        [ledger, note("loaf.md", loaf)],
      ).problems,
    ).toEqual([{ path: "loaf.md", rule: "plain/report", message: "Wrong." }]);
  });

  it("lets two schemas each have a rule of one name: its id is <schema>/<rule>", () => {
    const both = defineSchema({
      name: "both",
      description: "d",
      imports: [
        reporting("left", () => [{ message: "Left." }]),
        reporting("right", () => [{ message: "Right." }]),
      ],
      types: {},
    });
    expect(lint(both, [ledger, note("loaf.md", loaf)]).problems).toEqual([
      { path: "loaf.md", rule: "left/report", message: "Left." },
      { path: "loaf.md", rule: "right/report", message: "Right." },
    ]);
  });

  it("throws, as a fault of the rule, for a field its node's type does not have, or a report that is not { field?, message }", () => {
    const fails = (check: () => unknown) => () =>
      lint(reporting("faulty", check), [ledger, note("loaf.md", loaf)]);
    for (const field of ["/colour", "states", "/name"])
      expect(fails(() => [{ field, message: "m" }])).toThrow(
        new Error(
          `The rule faulty/report gave the field ${field} for loaf.md, which is not a JSON Pointer to a field its type object gives a node.`,
        ),
      );
    expect(fails(() => ["Wrong."])).toThrow(
      new Error(
        "The rule faulty/report gave something other than a list of { field?, message } for loaf.md.",
      ),
    );
    expect(fails(() => [{ message: "" }])).toThrow(
      new Error(
        "The rule faulty/report gave something other than a list of { field?, message } for loaf.md.",
      ),
    );
  });

  it("can name a field inside a field, by its path", () => {
    expect(
      lint(
        reporting("deep", () => [{ field: "/states/0", message: "Odd." }]),
        [ledger, note("loaf.md", loaf)],
      ).problems,
    ).toEqual([
      {
        path: "loaf.md",
        rule: "deep/report",
        field: "/states/0",
        message: "Odd.",
      },
    ]);
  });
});
