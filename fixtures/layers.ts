// Two schemas for the tests, one on the other: core, like que's ontology, and company, like one company's own,
// which imports core, extends its capability and links to its agent.
import * as z from "zod";
import { defineSchema, defineType, extendType, one } from "../src/index.ts";
import { fixture } from "./notes.ts";

export const agent = defineType({
  name: "agent",
  description: "One agent of a deployment.",
  fields: { role: z.string().min(1) },
});

export const capability = defineType({
  name: "capability",
  description: "An outcome someone wants from a system.",
  fields: { title: z.string().min(1) },
});

export const kase = defineType({
  name: "case",
  description: "One behaviour of one capability.",
  // The capability a case is about.
  fields: { capability: one(() => capability) },
});

export const core = defineSchema({
  name: "core",
  description: "Agents, capabilities and their cases.",
  types: { agent, capability, case: kase },
  typeNotes: fixture("types/core/"),
});

export const companyCapability = extendType(core.types.capability, {
  fields: {
    stage: z.enum(["idea", "live"]),
    // The agent that holds it.
    heldBy: one(() => core.types.agent),
  },
});

export const company = defineSchema({
  name: "company",
  description: "The company's capabilities, on core's.",
  imports: [core],
  types: { capability: companyCapability },
});
