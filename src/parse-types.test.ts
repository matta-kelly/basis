// The type a package's parse returns. Each check is made by the compiler; no note is parsed.
import { describe, expectTypeOf, it } from "vitest";
import things from "../fixtures/things.ts";

const asObject = () => things.parse("object", {});
const asExternal = () => things.parse("external-object", {});
const asSource = () => things.parse("source", {});
type Object = ReturnType<typeof asObject>;
type External = ReturnType<typeof asExternal>;
type Source = ReturnType<typeof asSource>;

describe("a parsed note's type", () => {
  it("has its type's fields, its type's name, and its links as names", () => {
    expectTypeOf<Object["type"]>().toEqualTypeOf<"object">();
    expectTypeOf<Object["name"]>().toEqualTypeOf<string>();
    expectTypeOf<Object["key"]>().toEqualTypeOf<string>();
    expectTypeOf<Object["states"]>().toEqualTypeOf<string[]>();
    expectTypeOf<Object["schema"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Object["livesIn"]>().toEqualTypeOf<string[]>();
    expectTypeOf<Object["representedAs"]>().toEqualTypeOf<
      string[] | undefined
    >();
  });

  it("has a one link as one name, on the type it starts from only", () => {
    expectTypeOf<External["heldIn"]>().toEqualTypeOf<string>();
    expectTypeOf<External>().not.toHaveProperty("livesIn");
  });

  it("is refused by the compiler for a type the package does not have, or a field the type does not have", () => {
    // @ts-expect-error: things has no type verb.
    void (() => things.parse("verb", {}));
    expectTypeOf<Source>().not.toHaveProperty("key");
    expectTypeOf<Source>().toHaveProperty("role");
  });
});
