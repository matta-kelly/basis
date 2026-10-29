---
type: doc
description: "A basis schema: a named set of types, with its imports, rules, notes, sources, exports and bridges; the built-in types node and type; and how schemas combine (they depend only downward, each name has one owner, a type is extended and never overridden). Read before writing or changing a defineSchema, or to know what a schema can import and expose."
status: active
---
Part of the schema in [[basis]] (Schema): the terms are those of [[state-machine]].

- **schema**: a named set of types, with the schemas it imports, and the subgraph they make: its rules, the folder of its notes (`notes`, a file URL), the paths there that are not notes (`skip`), the sources of its pieces (`sources`), its package's exports (`exports`, a function that gives them, `() => import("./index.ts")`), and the names of the exports that are bridges (`bridges`). Made with `defineSchema`. As a CUE package holds its types and its values, and as Bazel builds a target with all its deps, a schema's lint is its notes and every import's
	- the schema is the specification: a model of every valid graph. Its parts are its types ([[basis-type]]), its rules ([[basis-rule]]), and the built-in types, bridges and imports below; in code they are in `src/primitives.ts`
	- the words are those of the property graph (PG-Schema): node, type, property, link, schema, abstract type. Content collections (Astro) use other words for the same parts: a type is a collection, a node is an entry, and a link is a `reference()`
	- **built-in types**: `node` and `type`, held in the built-in schema `basis`. Every schema sees them as if it imported `basis`, as every GraphQL schema has `__Type`. They are basis's own words: no schema can define another type of their names
		- `node`: the abstract parent of every type, as GraphQL's `Node` interface. A link to it, or a rule on it, takes every node. No type lists it as a parent, and no schema extends it
		- `type`: the type of a type note. A schema can extend it. Its field `abstract` is `true` when the type the note explains is abstract, and `false` when not. The type's code gives it, as it gives `description`
	- **bridge**: an export a schema names in `bridges`: a shape an outside standard asks for, which no type defines
	- how schemas combine
		- dependency: a schema depends only downward. The graph has no cycles
			- test: "to understand this, what else must I understand?" Every answer points down
			- a cycle is fixed by a merge, or by a third piece both sit on
		- namespace: each name has one owner. Others refer to it, and never define it again
			- the same word in two schemas is two things (`shopify:product`, `odoo:product`)
			- outside copies of one thing link to it (the crosswalk pattern), and are not a second definition
		- extend, never override: a type can extend an imported type, and cannot change it. It adds only fields a node can leave out, so no node of the type stops fitting it ([[basis-type]], extension)
		- public and private: others depend on what a schema exposes, never on its insides
