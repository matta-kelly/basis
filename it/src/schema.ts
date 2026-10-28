/**
 * it: the kinds of notes Matt keeps, as types on basis. A note is an idea or a thing, by what it is: two abstract
 * types, which the other types inherit. Work is in the kinetic schema. Each type has a note in types/ that says what it is
 * for, and whose body a new note starts from. The package's folder is the schema's notes: this note and its type notes.
 */

import { defineSchema, defineType } from "@mku1tra/basis";
import * as z from "zod";

export const idea = defineType({
  name: "idea",
  description:
    "A note about an idea or a domain, by what it is; its status says how far the note can be trusted. Abstract: a note is of a type that inherits it.",
  abstract: true,
  fields: {
    status: z
      .enum(["draft", "active", "archived"])
      .describe(
        "draft: being written, not yet to be trusted. active: current and maintained. archived: out of date or superseded, kept for history",
      ),
  },
});

export const thing = defineType({
  name: "thing",
  description:
    "A note about a thing that exists and does something; its status says where the thing is in its life. Abstract: a note is of a type that inherits it.",
  abstract: true,
  fields: {
    status: z
      .enum(["planned", "running", "retired"])
      .describe(
        "planned: not built or not running yet. running: in use. retired: shut down, kept for history",
      ),
  },
});

export const moc = defineType({
  name: "moc",
  description:
    "Links and navigation as a note, where the structure describes the content and the content shapes the structure. Central and domain-like.",
  parents: [idea],
  fields: {},
});

export const doc = defineType({
  name: "doc",
  description:
    "A note that explains: a concept, a service, a thing. It can stand alone or grow into a central node; the fallback when no other type fits.",
  parents: [idea],
  fields: {},
});

export const sop = defineType({
  name: "sop",
  description:
    "A procedure to follow, steps in order, for a known result; use when a note tells the reader what to do, unlike a doc, which explains.",
  parents: [idea],
  fields: {},
});

export const tool = defineType({
  name: "tool",
  description:
    "A standalone lever, built for one job; use when a unit does one fixed task when invoked.",
  parents: [thing],
  fields: {},
});

export const component = defineType({
  name: "component",
  description:
    "A working piece of a service, app or project; use when a unit only makes sense as part of something larger.",
  parents: [thing],
  fields: {},
});

export const service = defineType({
  name: "service",
  description:
    "A thing that keeps running and gets used over an interface, by people or programs; unlike a tool you invoke, or a component that only exists inside something larger.",
  parents: [thing],
  fields: {},
});

export const role = defineType({
  name: "role",
  description:
    "The job one agent takes: one role, and the judgment it uses against the state docs it reads; unlike a tool, the agent decides how to do the job.",
  parents: [thing],
  fields: {},
});

// Named, then exported: tsc does not rewrite the `.ts` of an import() inside `export default`'s expression, so the
// built schema would import a file that is not in dist.
const it = defineSchema({
  name: "it",
  description: "The kinds of notes Matt keeps: ideas and things.",
  types: { idea, thing, moc, doc, sop, tool, component, service, role },
  typeNotes: new URL("../types/", import.meta.url),
  notes: new URL("../", import.meta.url),
  // Reality (it.md, Layers), with no frontmatter: the templates Templater fills, and the README npm shows.
  skip: (path) => path === "templater" || path === "README.md",
  exports: () => import("./schema.ts"),
});

export default it;
