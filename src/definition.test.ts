import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod";
import {
  defineSchema,
  defineType,
  lintFolder,
  markDefinition,
  type Source,
} from "./index.ts";

const made: string[] = [];
afterEach(async () => {
  await Promise.all(
    made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("the definition-piece rule", () => {
  // A package's type, and its define function: it parses an order and marks it as the definition of the order's node.
  const order = defineType({
    name: "order",
    description: "An order.",
    fields: { qty: z.number() },
  });
  const defineOrder = (definition: { name: string; qty: number }) =>
    markDefinition({ ...definition }, { name: definition.name, type: "order" });
  // A source that gives a piece of each order it is given.
  const reading = (...orders: { name: string; qty: number }[]): Source =>
    async function orderSource() {
      return {
        pieces: orders.map(({ name, qty }) => ({
          path: `orders/${name}`,
          name,
          fields: { type: "order", description: "An order.", qty },
        })),
        problems: [],
        unread: [],
      };
    };
  // The package's schema: its notes are the folder linted, and its sources give pieces beside them.
  const shop = (
    root: string,
    exports: Record<string, unknown>,
    sources: Source[],
  ) =>
    defineSchema({
      name: "shop",
      description: "d",
      types: { order },
      typeNotes: pathToFileURL(`${tmpdir()}/basis-no-type-notes/`),
      notes: pathToFileURL(`${root}/`),
      sources,
      exports: () => exports,
    });
  const ofRule = (problems: { rule?: string; message: string }[]) =>
    problems.filter((p) => p.rule === "basis/definition-piece");
  const folder = async () => {
    const root = await mkdtemp(join(tmpdir(), "basis-definition-"));
    made.push(root);
    return root;
  };

  it("gives a problem, naming the export, for a marked definition of which no source gives a piece of its name and type", async () => {
    const root = await folder();
    const big = defineOrder({ name: "big", qty: 9 });
    const { problems } = await lintFolder(
      shop(root, { big }, [reading({ name: "small", qty: 1 })]),
      root,
    );
    expect(ofRule(problems)).toEqual([
      {
        path: ".",
        rule: "basis/definition-piece",
        message:
          "The export big of shop is the definition of the order big, and no source gives a piece of it: a source of the package gives a piece of each definition it exports.",
      },
    ]);
  });

  it("gives a problem for a marked definition of which only a note gives a piece", async () => {
    const root = await folder();
    await writeFile(
      join(root, "big.md"),
      "---\ntype: order\ndescription: An order.\nqty: 9\n---\n",
    );
    const big = defineOrder({ name: "big", qty: 9 });
    const { problems } = await lintFolder(shop(root, { big }, []), root);
    expect(ofRule(problems).map((p) => p.message)).toEqual([
      "The export big of shop is the definition of the order big, and no source gives a piece of it: a source of the package gives a piece of each definition it exports.",
    ]);
  });

  it("gives a problem, naming its place, for a marked definition inside a list or a plain object of the exports", async () => {
    const root = await folder();
    const big = defineOrder({ name: "big", qty: 9 });
    const { problems } = await lintFolder(
      shop(root, { default: { orders: [big] } }, []),
      root,
    );
    expect(ofRule(problems).map((p) => p.message)).toEqual([
      "The export default of shop, at /orders/0, is the definition of the order big, and no source gives a piece of it: a source of the package gives a piece of each definition it exports.",
    ]);
  });

  it("gives no problem for a marked definition of which a source gives a piece of its name and type", async () => {
    const root = await folder();
    const big = defineOrder({ name: "big", qty: 9 });
    const { problems } = await lintFolder(
      shop(root, { big, default: { orders: [big] } }, [
        reading({ name: "big", qty: 9 }),
      ]),
      root,
    );
    expect(ofRule(problems)).toEqual([]);
  });

  it("gives a problem for a marked definition of which only a source of a graph above the schema gives a piece", async () => {
    const root = await folder();
    await mkdir(join(root, "shop"));
    const big = defineOrder({ name: "big", qty: 9 });
    const above = defineSchema({
      name: "above",
      description: "d",
      imports: [shop(join(root, "shop"), { big }, [])],
      types: {},
    });
    const { problems } = await lintFolder(above, root, {
      sources: [reading({ name: "big", qty: 9 })],
    });
    expect(ofRule(problems).map((p) => p.message)).toEqual([
      "The export big of shop is the definition of the order big, and no source gives a piece of it: a source of the package gives a piece of each definition it exports.",
    ]);
  });

  it("gives no problem for exports with no marked value", async () => {
    const root = await folder();
    const { problems } = await lintFolder(
      shop(root, { order, plain: { name: "big", qty: 9 }, version: "1" }, []),
      root,
    );
    expect(ofRule(problems)).toEqual([]);
  });

  it("reads a value that holds itself once", async () => {
    const big = defineOrder({ name: "big", qty: 9 });
    const loop: Record<string, unknown> = { orders: [big] };
    loop.self = loop;
    const root = await folder();
    const { problems } = await lintFolder(
      shop(root, { default: loop }, []),
      root,
    );
    expect(ofRule(problems).map((p) => p.message)).toEqual([
      "The export default of shop, at /orders/0, is the definition of the order big, and no source gives a piece of it: a source of the package gives a piece of each definition it exports.",
    ]);
  });

  it("does not read into a value of a class, a function, a zod schema, a Map or a Set", async () => {
    const big = defineOrder({ name: "big", qty: 9 });
    class Box {
      orders = [big];
    }
    const root = await folder();
    const { problems } = await lintFolder(
      shop(
        root,
        {
          box: new Box(),
          run: Object.assign(() => undefined, { orders: [big] }),
          Order: Object.assign(z.object({}), { orders: [big] }),
          byName: new Map([["big", big]]),
          all: new Set([big]),
        },
        [],
      ),
      root,
    );
    expect(ofRule(problems)).toEqual([]);
  });

  it("throws, naming the schema, when a value of its exports throws as it is read", async () => {
    const root = await folder();
    const throwing = {
      get orders(): never {
        throw new Error("getter boom");
      },
    };
    await expect(
      lintFolder(shop(root, { default: throwing }, []), root),
    ).rejects.toThrow("The exports of shop threw: getter boom");
    await expect(lintFolder(shop(root, throwing, []), root)).rejects.toThrow(
      "The exports of shop threw: getter boom",
    );
  });

  it("reads only a mark of the value's own, not one it inherits", async () => {
    const big = defineOrder({ name: "big", qty: 9 });
    class Order {}
    markDefinition(Order, { name: "order-class", type: "order" });
    class Rush extends Order {}
    const root = await folder();
    const { problems } = await lintFolder(
      shop(root, { Rush, copy: Object.create(big) as object }, []),
      root,
    );
    expect(ofRule(problems)).toEqual([]);
  });

  it("reads a definition marked by another install of basis as one marked by its own", async () => {
    // A second copy of the module, as another install of basis gives: its own functions, and no state shared with this one.
    const another = "./definition.ts?another-install";
    const copy = (await import(another)) as typeof import("./definition.ts");
    expect(copy.markDefinition).not.toBe(markDefinition);
    const big = copy.markDefinition({ qty: 9 }, { name: "big", type: "order" });
    const root = await folder();
    const { problems } = await lintFolder(shop(root, { big }, []), root);
    expect(ofRule(problems).map((p) => p.message)).toEqual([
      "The export big of shop is the definition of the order big, and no source gives a piece of it: a source of the package gives a piece of each definition it exports.",
    ]);
  });
});

describe("markDefinition", () => {
  const key = Symbol.for("@mku1tra/basis/definition");

  it("gives the value it marks, with a mark that is not enumerable and cannot change", () => {
    const value = { qty: 9 };
    const marked = markDefinition(value, { name: "big", type: "order" });
    expect(marked).toBe(value);
    expect(Object.getOwnPropertyDescriptor(marked, key)).toEqual({
      value: { name: "big", type: "order" },
      enumerable: false,
      writable: false,
      configurable: false,
    });
    expect(Object.isFrozen(Reflect.get(marked, key))).toBe(true);
    expect(JSON.stringify(marked)).toBe('{"qty":9}');
    expect(Object.getOwnPropertySymbols({ ...marked })).toEqual([]);
  });

  it("throws a TypeError for a value that is marked already, is frozen, or is no object", () => {
    const marked = markDefinition({}, { name: "big", type: "order" });
    expect(() =>
      markDefinition(marked, { name: "small", type: "order" }),
    ).toThrow(TypeError);
    expect(() =>
      markDefinition(Object.freeze({}), { name: "big", type: "order" }),
    ).toThrow(TypeError);
    expect(() =>
      markDefinition(9 as never, { name: "big", type: "order" }),
    ).toThrow(TypeError);
  });

  it("throws a TypeError for a name that is no slug, or a type that is no name", () => {
    expect(() =>
      markDefinition({}, { name: undefined as never, type: "order" }),
    ).toThrow(TypeError);
    expect(() =>
      markDefinition({}, { name: "Not A Slug", type: "order" }),
    ).toThrow(TypeError);
    expect(() => markDefinition({}, { name: "u" } as never)).toThrow(TypeError);
    expect(() => markDefinition({}, { name: "u", type: "" })).toThrow(
      TypeError,
    );
  });
});
