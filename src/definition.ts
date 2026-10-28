/**
 * A definition: a value that code gives as the definition of one node, marked with the node's name and type. A
 * package's `define*` function marks what it gives, so the lint finds each definition in the package's exports itself,
 * and does not take a source's word for what it read.
 */

import { inspect } from "node:util";
import { Name } from "./primitives.ts";

/**
 * The key of the mark, from the global symbol registry: each install of basis, and each copy of its module, gets the
 * same symbol, as React marks an element with `Symbol.for("react.element")`. It keeps its name, as a rule's id does.
 */
const mark = Symbol.for("@mku1tra/basis/definition");

/** What a definition is of: the name and the type of its node. */
export interface Definition {
  name: string;
  type: string;
}

/**
 * Marks a value as the definition of the node of `name` and `type`, and gives the value. The mark is a property of
 * the value that is not enumerable, so it is not copied by a spread or written by JSON, and cannot be changed. Throws
 * a TypeError when the name is no slug or the type no non-empty string, and, as `Object.defineProperty` does, when
 * the value is not an object, is frozen, or is marked already.
 */
export function markDefinition<T extends object>(
  value: T,
  { name, type }: Definition,
): T {
  if (!Name.safeParse(name).success)
    throw new TypeError(
      `A definition's name is a slug: lowercase letters and digits, with single hyphens between them. Given: ${inspect(name)}.`,
    );
  if (typeof type !== "string" || type === "")
    throw new TypeError(
      `A definition's type is the name of its type. Given: ${inspect(type)}.`,
    );
  return Object.defineProperty(value, mark, {
    value: Object.freeze({ name, type }),
  });
}

/** The definition a value is marked as, by a mark of its own, whichever install of basis marked it; or none. */
export function definitionOf(value: unknown): Definition | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || !value)
    return undefined;
  // Its own mark only: a value made from a definition, a subclass or Object.create, is not that definition.
  const marked: unknown = Object.getOwnPropertyDescriptor(value, mark)?.value;
  if (typeof marked !== "object" || marked === null) return undefined;
  const { name, type } = marked as Record<string, unknown>;
  return typeof name === "string" && typeof type === "string"
    ? { name, type }
    : undefined;
}
