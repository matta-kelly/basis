// A small package for the tests: three types from the lotusandluna ontology, and the links between them.
import * as z from "zod";
import {
  definePackage,
  defineType,
  many,
  manyOrNone,
  Name,
  one,
} from "../src/index.ts";

export const source = defineType({
  name: "source",
  description: "A place data lives.",
  fields: {
    role: z.enum(["entry", "record", "projection"]),
    connector: Name.optional(),
    kind: z.enum(["marketplace"]).optional(),
  },
});

export const object = defineType({
  name: "object",
  description: "What the business is made of.",
  fields: {
    key: z.string().min(1),
    schema: z.string().min(1).optional(),
    states: z.array(Name).min(1),
    derived: z.array(Name).optional(),
    issues: z.array(z.string().min(1)).optional(),
    // The sources that hold it.
    livesIn: many(() => source),
    // Its outside copies. The type is defined below: the package reads the thunk.
    representedAs: manyOrNone(() => externalObject),
  },
});

export const externalObject = defineType({
  name: "external-object",
  description: "An outside copy of an object, as a source holds it.",
  fields: {
    schema: z.string().min(1).optional(),
    issues: z.array(z.string().min(1)).optional(),
    // The source that holds it.
    heldIn: one(() => source),
  },
});

export default definePackage({
  name: "things",
  description: "What exists, and where.",
  types: { source, object, "external-object": externalObject },
});
