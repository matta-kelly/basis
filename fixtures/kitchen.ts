// A schema for the tests of type notes: its folder, types/kitchen/, holds notes that are wrong on purpose. tray, oven
// and roll have their right notes, which give only prose; pan and bun have none; scone's gives abstract and loaf's a
// description, which their code gives; crumb's cannot be read; and till.md explains a type kitchen does not have.
import { defineSchema, defineType } from "../src/index.ts";

const kind = <const N extends string>(
  name: N,
  description: string,
  abstract = false,
) => defineType({ name, description, abstract, fields: {} });

export default defineSchema({
  name: "kitchen",
  description: "What a bakery makes, and where.",
  types: {
    tray: kind("tray", "What a bake sits on.", true),
    pan: kind("pan", "What a bake is shaped in.", true),
    oven: kind("oven", "Where a bake is made.", true),
    roll: kind("roll", "A small bread."),
    bun: kind("bun", "A soft bread."),
    loaf: kind("loaf", "A loaf of bread."),
    scone: kind("scone", "A sweet bake."),
    crumb: kind("crumb", "What a bake leaves."),
  },
  typeNotes: new URL("./types/kitchen/", import.meta.url),
});
