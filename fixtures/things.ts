// A small package for the tests: two types from the lotusandluna ontology, and the link between them.
import * as z from "zod";
import { defineLink, definePackage, defineType } from "../src/index.ts";

export const source = defineType({
  name: "source",
  description: "A place data lives.",
  properties: { role: z.enum(["entry", "record", "projection"]) },
});

export const object = defineType({
  name: "object",
  description: "What the business is made of.",
  properties: { key: z.string().min(1) },
});

export const livesIn = defineLink({
  name: "livesIn",
  description: "The sources that hold it.",
  from: object,
  to: source,
  cardinality: "many",
});

export default definePackage({
  name: "things",
  description: "What exists, and where.",
  types: [source, object],
  links: [livesIn],
});
