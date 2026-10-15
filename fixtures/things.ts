// A small package for the tests: three types from the lotusandluna ontology, and the links between them.
import * as z from "zod";
import { defineLink, definePackage, defineType, Name } from "../src/index.ts";

export const source = defineType({
  name: "source",
  description: "A place data lives.",
  properties: {
    role: z.enum(["entry", "record", "projection"]),
    connector: Name.optional(),
    kind: z.enum(["marketplace"]).optional(),
  },
});

export const object = defineType({
  name: "object",
  description: "What the business is made of.",
  properties: {
    key: z.string().min(1),
    schema: z.string().min(1).optional(),
    states: z.array(Name).min(1),
    derived: z.array(Name).optional(),
    issues: z.array(z.string().min(1)).optional(),
  },
});

export const externalObject = defineType({
  name: "external-object",
  description: "An outside copy of an object, as a source holds it.",
  properties: {
    schema: z.string().min(1).optional(),
    issues: z.array(z.string().min(1)).optional(),
  },
});

export const livesIn = defineLink({
  name: "livesIn",
  description: "The sources that hold it.",
  from: object,
  to: source,
  cardinality: "many",
});

export const representedAs = defineLink({
  name: "representedAs",
  description: "Its outside copies.",
  from: object,
  to: externalObject,
  cardinality: "many",
  required: false,
});

export const heldIn = defineLink({
  name: "heldIn",
  description: "The source that holds it.",
  from: externalObject,
  to: source,
  cardinality: "one",
});

export default definePackage({
  name: "things",
  description: "What exists, and where.",
  types: [source, object, externalObject],
  links: [livesIn, representedAs, heldIn],
});
