import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as z from "zod";
import things, { object, source } from "../fixtures/things.ts";
import {
  defineRule,
  defineSchema,
  defineType,
  extendType,
  type Graph,
  lint,
  lintFolder,
  many,
  type Note,
  type Rule,
  type Type,
} from "./index.ts";

const note = (path: string, fields: Record<string, unknown>): Note => ({
  path,
  name: basename(path, ".md"),
  fields,
  body: "",
  source: "notes",
});

// A rule in one note: each derived state is one of its states.
const derivedStates = defineRule({
  name: "derived-states",
  description: "Each derived state of an object is one of its states.",
  on: object,
  check: (node) =>
    (node.derived ?? [])
      .filter((state) => !node.states.includes(state))
      .map((state) => ({
        field: "/derived",
        message: `The derived state ${state} is not one of its states.`,
      })),
});

// A rule across a link: an object lives in at least one source of record.
const inRecord = defineRule({
  name: "in-record",
  description: "An object lives in at least one source whose role is record.",
  on: object,
  check: (node, graph) =>
    node.livesIn.some((name) => graph.get(name, source)?.role === "record")
      ? []
      : [{ field: "/livesIn", message: "It lives in no source of record." }],
});

const ruled = defineSchema({
  name: "ruled",
  description: "things, with rules.",
  imports: [things],
  types: {},
  rules: [derivedStates, inRecord],
});

const ledger = note("ledger.md", {
  type: "source",
  description: "The books.",
  role: "record",
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
  livesIn: ["[[ledger]]"],
  states: ["drafted", "complete"],
  derived: ["complete"],
});

describe("a rule", () => {
  it("is refused with a name that is not a slug, by a plain Error", () => {
    expect(() =>
      defineRule({
        name: "In Record",
        description: "d",
        on: object,
        check: () => [],
      }),
    ).toThrow(
      new Error("The rule In Record is not named by a lowercase slug."),
    );
  });

  it("is refused with a check that is not a function, made without TypeScript", () => {
    expect(() =>
      defineRule({
        name: "no-check",
        description: "d",
        on: object,
        check: "nothing" as never,
      }),
    ).toThrow(new Error("The rule no-check has no check function."));
  });

  it("is frozen", () => {
    expect(Object.isFrozen(inRecord)).toBe(true);
  });

  it("gives its node parsed and typed to its check, and the graph", () => {
    defineRule({
      name: "typed",
      description: "d",
      on: object,
      check: (node, graph) => {
        expectTypeOf(node.states).toEqualTypeOf<string[]>();
        expectTypeOf(node.livesIn).toEqualTypeOf<string[]>();
        expectTypeOf(graph).toEqualTypeOf<Graph>();
        expectTypeOf(graph.get("x", source)?.role).toEqualTypeOf<
          "entry" | "record" | "projection" | undefined
        >();
        return [];
      },
    });
  });
});

describe("a schema with rules", () => {
  const rule = (name: string, on: Type = object): Rule =>
    defineRule({ name, description: "d", on, check: () => [] });

  it("is refused with a rule that defineRule did not make, made without TypeScript", () => {
    expect(() =>
      defineSchema({
        name: "loose",
        description: "d",
        imports: [things],
        types: {},
        rules: [{ ...inRecord }],
      }),
    ).toThrow(
      new Error(
        "The schema loose has the rule in-record, which defineRule did not make.",
      ),
    );
  });

  it("is refused with a rule on a type it does not see", () => {
    const far = defineType({ name: "far", description: "d", fields: {} });
    expect(() =>
      defineSchema({
        name: "blind",
        description: "d",
        types: {},
        rules: [rule("far-rule", far)],
      }),
    ).toThrow(
      new Error(
        "The rule blind/far-rule runs on far, which is not a type of the schema blind or its imports.",
      ),
    );
  });

  it("is refused with two rules of one name in it, and takes a rule of a name a schema it sees has: the id is <schema>/<rule>", () => {
    expect(() =>
      defineSchema({
        name: "twice",
        description: "d",
        imports: [things],
        types: {},
        rules: [rule("same"), rule("same")],
      }),
    ).toThrow(new Error("The schema twice has two rules named same."));
    const again = defineSchema({
      name: "again",
      description: "d",
      imports: [ruled],
      types: {},
      rules: [inRecord],
    });
    const lost = note("loaf.md", {
      ...loaf.fields,
      livesIn: ["[[till]]"],
    });
    expect(lint(again, [till, lost]).problems.map((p) => p.rule)).toEqual([
      "ruled/in-record",
      "again/in-record",
    ]);
  });

  it("sees one rule once, through two imports", () => {
    const left = defineSchema({
      name: "left",
      description: "d",
      imports: [ruled],
      types: {},
    });
    const right = defineSchema({
      name: "right",
      description: "d",
      imports: [ruled],
      types: {},
    });
    const both = defineSchema({
      name: "both",
      description: "d",
      imports: [left, right],
      types: {},
    });
    const lost = { ...loaf.fields, livesIn: ["[[till]]"] };
    expect(lint(both, [till, note("loaf.md", lost)]).problems).toEqual([
      {
        path: "loaf.md",
        rule: "ruled/in-record",
        field: "/livesIn",
        message: "It lives in no source of record.",
      },
    ]);
  });

  it("is refused with rules that are not a list, made without TypeScript", () => {
    expect(() =>
      defineSchema({
        name: "odd",
        description: "d",
        types: {},
        rules: inRecord as never,
      }),
    ).toThrow(new Error("The rules of odd are not a list."));
  });

  it("checks the rules of each schema it sees, so a spread import cannot bring a rule defineRule did not make", () => {
    const spread = (rules: unknown) =>
      defineSchema({
        name: "spreading",
        description: "d",
        imports: [{ ...things, rules: rules as never }],
        types: {},
      });
    expect(() => spread([{ ...inRecord }])).toThrow(
      new Error(
        "The schema things has the rule in-record, which defineRule did not make.",
      ),
    );
    expect(() => spread("nope")).toThrow(
      new Error("The rules of things are not a list."),
    );
    expect(() => spread([rule("d"), rule("d")])).toThrow(
      new Error("The schema things has two rules named d."),
    );
  });

  it("is refused by defineRule with a type defineType did not make, or no description, made without TypeScript", () => {
    expect(() =>
      defineRule({
        name: "nowhere",
        description: "d",
        on: undefined as never,
        check: () => [],
      }),
    ).toThrow(
      new Error(
        "The rule nowhere runs on undefined, which defineType did not make.",
      ),
    );
    expect(() =>
      defineRule({
        name: "mute",
        description: 3 as never,
        on: object,
        check: () => [],
      }),
    ).toThrow(new Error("The rule mute has no description."));
  });
});

describe("the lint of rules", () => {
  it("gives no problem when each rule holds", () => {
    expect(lint(ruled, [ledger, till, loaf]).problems).toEqual([]);
  });

  it("gives each report of a rule as a problem of its note, with the rule's id <schema>/<rule>", () => {
    const wrong = note("loaf.md", {
      ...loaf.fields,
      livesIn: ["[[till]]"],
      derived: ["burnt", "stale"],
    });
    expect(lint(ruled, [ledger, till, wrong]).problems).toEqual([
      {
        path: "loaf.md",
        rule: "ruled/derived-states",
        field: "/derived",
        message: "The derived state burnt is not one of its states.",
      },
      {
        path: "loaf.md",
        rule: "ruled/derived-states",
        field: "/derived",
        message: "The derived state stale is not one of its states.",
      },
      {
        path: "loaf.md",
        rule: "ruled/in-record",
        field: "/livesIn",
        message: "It lives in no source of record.",
      },
    ]);
  });

  it("runs the rules of an imported schema", () => {
    const top = defineSchema({
      name: "top",
      description: "d",
      imports: [ruled],
      types: {},
    });
    const lost = note("loaf.md", {
      ...loaf.fields,
      livesIn: ["[[till]]"],
    });
    expect(lint(top, [till, lost]).problems).toMatchObject([
      { path: "loaf.md", rule: "ruled/in-record" },
    ]);
  });

  it("does not run on a note that does not parse: the note has its own problems", () => {
    const broken = note("loaf.md", {
      ...loaf.fields,
      livesIn: ["[[till]]"],
      states: [],
    });
    const problems = lint(ruled, [till, broken]).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      rule: "basis/fields",
      field: "/states",
    });
  });

  it("gives the graph the parsed nodes: a link as a name, and none for a missing note, a note of another type, a note that does not parse, or a name two notes share", () => {
    const seen: unknown[] = [];
    const look = defineRule({
      name: "look",
      description: "d",
      on: object,
      check: (_node, graph) => {
        seen.push(
          graph.get("ledger", source),
          graph.get("nowhere", source),
          graph.get("loaf", source),
          graph.get("broken", source),
          graph.get("twin", source),
        );
        return [];
      },
    });
    const schema = defineSchema({
      name: "looking",
      description: "d",
      imports: [things],
      types: {},
      rules: [look],
    });
    const broken = note("broken.md", { type: "source", description: "d" });
    const twin = { type: "source", description: "d", role: "entry" };
    lint(schema, [
      ledger,
      loaf,
      broken,
      note("a/twin.md", twin),
      note("b/twin.md", twin),
    ]);
    expect(seen).toEqual([
      {
        type: "source",
        name: "ledger",
        description: "The books.",
        role: "record",
      },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("gives every parsed node of a type, and of each type that inherits it", () => {
    const grain = defineType({
      name: "grain",
      description: "d",
      abstract: true,
      fields: {},
    });
    const rye = defineType({
      name: "rye",
      description: "d",
      parents: [grain],
      fields: {},
    });
    const spelt = defineType({
      name: "spelt",
      description: "d",
      parents: [grain],
      fields: {},
    });
    const sack = defineType({
      name: "sack",
      description: "d",
      fields: { holds: many(() => grain) },
    });
    const names: string[][] = [];
    const count = defineRule({
      name: "count",
      description: "d",
      on: sack,
      check: (_node, graph) => {
        names.push(graph.all(grain).map((node) => node.name));
        return [];
      },
    });
    const store = defineSchema({
      name: "store",
      description: "d",
      types: { grain, rye, spelt, sack },
      typeNotes: new URL("./types/", import.meta.url),
      rules: [count],
    });
    lint(store, [
      note("r.md", { type: "rye", description: "d" }),
      note("s.md", { type: "spelt", description: "d" }),
      note("k.md", { type: "sack", description: "d", holds: ["[[r]]"] }),
    ]);
    expect(names).toEqual([["r", "s"]]);
  });

  it("runs a rule on an abstract type on the nodes of each type that inherits it", () => {
    const tool = defineType({
      name: "tool",
      description: "d",
      abstract: true,
      fields: { owner: z.string().optional() },
    });
    const knife = defineType({
      name: "knife",
      description: "d",
      parents: [tool],
      fields: {},
    });
    const owned = defineRule({
      name: "owned",
      description: "Every tool has an owner.",
      on: tool,
      check: (node) => (node.owner ? [] : [{ message: "It has no owner." }]),
    });
    const shed = defineSchema({
      name: "shed",
      description: "d",
      types: { tool, knife },
      typeNotes: new URL("./types/", import.meta.url),
      rules: [owned],
    });
    expect(
      lint(shed, [note("k.md", { type: "knife", description: "d" })]).problems,
    ).toEqual([
      { path: "k.md", rule: "shed/owned", message: "It has no owner." },
    ]);
  });

  it("runs a rule on a type on the notes of its extension, which is the same type", () => {
    const wider = defineSchema({
      name: "wider",
      description: "d",
      imports: [ruled],
      types: {
        object: extendType(object, {
          fields: { colour: z.string().optional() },
        }),
      },
    });
    const lost = note("loaf.md", {
      ...loaf.fields,
      livesIn: ["[[till]]"],
      colour: "brown",
    });
    expect(lint(wider, [till, lost]).problems).toMatchObject([
      { path: "loaf.md", rule: "ruled/in-record" },
    ]);
  });

  it("throws, naming the rule, when the rule reads the graph by a type the schema does not see", () => {
    const other = defineType({
      name: "source",
      description: "d",
      fields: { needed: z.number() },
    });
    const reads = defineRule({
      name: "reads",
      description: "d",
      on: object,
      check: (_node, graph) => [
        { message: String(graph.get("ledger", other)?.needed) },
      ],
    });
    const schema = defineSchema({
      name: "reading",
      description: "d",
      imports: [things],
      types: {},
      rules: [reads],
    });
    expect(() => lint(schema, [ledger, loaf])).toThrow(
      new Error(
        "The rule reading/reads threw on loaf.md: The type source is not a type of the schema reading or its imports.",
      ),
    );
  });

  it("does not run a rule on an extension on a type that inherits the type extended, which does not have the extension's fields", () => {
    const colouredObject = extendType(object, {
      fields: { colour: z.string() },
    });
    const coloured = defineRule({
      name: "coloured",
      description: "d",
      on: colouredObject,
      check: (node) => [{ message: `It is ${node.colour}.` }],
    });
    const ext = defineSchema({
      name: "ext",
      description: "d",
      imports: [things],
      types: { object: colouredObject },
      rules: [coloured],
    });
    const bun = defineType({
      name: "bun",
      description: "d",
      parents: [object],
      fields: {},
    });
    const sub = defineSchema({
      name: "sub",
      description: "d",
      imports: [things],
      types: { bun },
      typeNotes: new URL("./types/", import.meta.url),
    });
    const top = defineSchema({
      name: "top-ext",
      description: "d",
      imports: [ext, sub],
      types: {},
    });
    expect(
      lint(top, [
        ledger,
        note("brown.md", { ...loaf.fields, key: "b", colour: "brown" }),
        note("roll.md", { ...loaf.fields, type: "bun", key: "r" }),
      ]).problems,
    ).toEqual([
      { path: "brown.md", rule: "ext/coloured", message: "It is brown." },
    ]);
  });

  it("leaves the caller's fields as they were, with rules and without", () => {
    const extra = { a: [1] };
    const holder = defineType({
      name: "holder",
      description: "d",
      fields: { extra: z.unknown() },
    });
    const looks = defineRule({
      name: "looks",
      description: "d",
      on: holder,
      check: () => [],
    });
    for (const rules of [[], [looks]])
      lint(
        defineSchema({
          name: "holding",
          description: "d",
          types: { holder },
          typeNotes: new URL("./types/", import.meta.url),
          rules,
        }),
        [note("h.md", { type: "holder", description: "d", extra })],
      );
    expect(Object.isFrozen(extra) || Object.isFrozen(extra.a)).toBe(false);
  });

  it("gives frozen nodes, so one rule cannot change what another sees", () => {
    const change = defineRule({
      name: "change",
      description: "d",
      on: object,
      check: (node) => {
        node.states.push("burnt");
        return [];
      },
    });
    const schema = defineSchema({
      name: "changing",
      description: "d",
      imports: [things],
      types: {},
      rules: [change],
    });
    expect(() => lint(schema, [ledger, loaf])).toThrow(
      /^The rule changing\/change threw on loaf\.md:/,
    );
  });

  it("gives each live value as its piece gives it, a function and a zod schema, and copies and freezes only plain data", () => {
    const op = defineType({
      name: "op",
      description: "d",
      fields: {
        run: z.custom<() => number>((value) => typeof value === "function"),
        input: z.instanceof(z.ZodObject),
        tags: z.array(z.string()),
      },
    });
    let got: { run: unknown; input: unknown; tags: string[] } | undefined;
    let fromGraph: unknown;
    const reads = defineRule({
      name: "reads",
      description: "d",
      on: op,
      check: (node, graph) => {
        got = node;
        fromGraph = graph.get("search", op);
        return [];
      },
    });
    const run = () => 42;
    const input = z.object({ q: z.string() });
    const tags = ["a"];
    const problems = lint(
      defineSchema({
        name: "live",
        description: "d",
        types: { op },
        typeNotes: new URL("./types/", import.meta.url),
        rules: [reads],
      }),
      [
        {
          path: "code/search.ts",
          name: "search",
          source: "1",
          fields: { type: "op", description: "d", run, input, tags },
        },
      ],
    ).problems;
    expect(problems).toEqual([]);
    expect(got?.run).toBe(run);
    expect(got?.input).toBe(input);
    expect(Object.isFrozen(input)).toBe(false);
    expect(got?.tags).toEqual(["a"]);
    expect(got?.tags).not.toBe(tags);
    expect(Object.isFrozen(got?.tags)).toBe(true);
    expect(fromGraph).toBe(got);
  });

  it("gives a value that holds itself, as a YAML alias makes, as a frozen copy that holds itself", () => {
    const holder = defineType({
      name: "holder",
      description: "d",
      fields: { extra: z.unknown() },
    });
    let got: { extra?: unknown } | undefined;
    const reads = defineRule({
      name: "reads",
      description: "d",
      on: holder,
      check: (node) => {
        got = node;
        return [];
      },
    });
    const extra: unknown[] = [];
    extra.push(extra);
    lint(
      defineSchema({
        name: "holding",
        description: "d",
        types: { holder },
        typeNotes: new URL("./types/", import.meta.url),
        rules: [reads],
      }),
      [note("h.md", { type: "holder", description: "d", extra })],
    );
    const copy = got?.extra as unknown[];
    expect(copy).not.toBe(extra);
    expect(copy[0]).toBe(copy);
    expect(Object.isFrozen(copy)).toBe(true);
  });

  it("gives a field named __proto__ in a value as its own key, and makes nothing inherited", () => {
    const holder = defineType({
      name: "holder",
      description: "d",
      fields: { extra: z.unknown() },
    });
    let got: { extra?: unknown } | undefined;
    const reads = defineRule({
      name: "reads",
      description: "d",
      on: holder,
      check: (node) => {
        got = node;
        return [];
      },
    });
    const extra: unknown = JSON.parse('{"__proto__": {"polluted": true}}');
    lint(
      defineSchema({
        name: "holding",
        description: "d",
        types: { holder },
        typeNotes: new URL("./types/", import.meta.url),
        rules: [reads],
      }),
      [note("h.md", { type: "holder", description: "d", extra })],
    );
    const copy = got?.extra as Record<string, unknown>;
    expect(Object.hasOwn(copy, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(copy.polluted).toBeUndefined();
  });

  it("throws, naming the rule and the note, when a check throws or gives something other than a list of { field?, message }", () => {
    const fails = (name: string, check: () => unknown) =>
      defineSchema({
        name,
        description: "d",
        imports: [things],
        types: {},
        rules: [
          defineRule({
            name: `${name}-rule`,
            description: "d",
            on: object,
            check: check as never,
          }),
        ],
      });
    expect(() =>
      lint(
        fails("bad", () => {
          throw new Error("no oven");
        }),
        [ledger, loaf],
      ),
    ).toThrow(new Error("The rule bad/bad-rule threw on loaf.md: no oven"));
    expect(() =>
      lint(
        fails("odd", () => "wrong"),
        [ledger, loaf],
      ),
    ).toThrow(
      new Error(
        "The rule odd/odd-rule gave something other than a list of { field?, message } for loaf.md.",
      ),
    );
  });

  it("runs in a folder's lint", async () => {
    const folder = await mkdtemp(join(tmpdir(), "basis-rules-"));
    try {
      await writeFile(
        join(folder, "till.md"),
        "---\ntype: source\ndescription: The shop's till.\nrole: projection\n---\n",
      );
      await writeFile(
        join(folder, "loaf.md"),
        "---\ntype: object\ndescription: d\nkey: k\nlivesIn: ['[[till]]']\nstates: [drafted]\n---\n",
      );
      const schema = defineSchema({
        name: "folder-ruled",
        description: "d",
        imports: [things],
        types: {},
        rules: [inRecord],
      });
      const problems = (
        await lintFolder(schema, folder, {
          skip: (path) => path === "types",
        })
      ).problems;
      expect(problems.filter((p) => p.path === "loaf.md")).toEqual([
        {
          path: "loaf.md",
          rule: "folder-ruled/in-record",
          field: "/livesIn",
          message: "It lives in no source of record.",
        },
      ]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
