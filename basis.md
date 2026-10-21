---
type: moc
description: "basis: the base package for semantic subgraphs. The meta primitives, the compiler and the lint core that every subgraph imports. Read for what basis is and what it is made of."
status: active
---
Define small pieces that build only downward, and check reality against them.
- [[#Thesis]] why an ontology, and what a subgraph is
- [[#Primitives]] the meta vocabulary, and the rules for how schemas combine
- [[#Lint]] what a linter is, and the layers of its rules
- [[#Foundation]] the language and the libraries
- [[#Components]] the parts of basis, in the order they depend on each other

#### Desk
- Next
- Inbox

---
## Thesis

- an ontology breaks a thing into a structure that makes sense. It gives two things
	- the parts to build systems from
	- something to check reality against: linting, evals, the definition as the source of truth (semantic IaC)
- everything is a graph. A subgraph is one piece of it, small enough to own, check and build on
- a subgraph is a package: an npm package, with its notes, its types (made with basis, on zod), and a `package.json` that names what it depends on
	- npm gives versions, resolution and install. No own package format
- a harness (que) mounts the subgraphs it is given and navigates them. That is the goal: agent legibility
- the same idea exists closed (Palantir Ontology and AIP). basis is the open version: small subgraphs that stack by import and are checked by lint
- basis is PG-Schema plus schemas that import each other. Binding, connector, tool, skill and navigation are real, and belong to the packages that import basis, such as que, not to basis
- basis imports nothing. A package that imports it says so in its own note; basis keeps no map of what is built on it

## Primitives

- the vocabulary: what a subgraph is made of. Each one is in `src/primitives.ts`, and this section says what it means
	- **node**: one actual thing, as one note. Its frontmatter holds its fields, and its file name is its name
	- **base**: what every node carries, whatever its type: `name`, `type` and `description`. Every type extends it, and fixes `type` to its own name
	- **type**: a kind of node. It has its fields beside the base, and an identity rule (its `key`: fields no two of its nodes share). Made with `defineType`
		- a type can extend another type with `extendType`, and add fields. It cannot change the fields it extends
	- **property**: a named field of a type, with a zod schema
	- **constraint**: a rule on a field, such as required, a minimum or a pattern. It is the field's zod schema, not a primitive of its own
	- **link**: a field of the type it starts from, whose schema records the type it points at. Written in a note as `[[name]]`
		- one, oneOrNone, many (one or more), or manyOrNone (none, or an empty list). The lint checks each one points at a note of one of its types
		- data on a link itself is not supported yet
		- whether an absent optional link is worth a warning is a lint rule, not a schema question
	- **interface**: a type with no nodes of its own, so several types count as one kind. Not in the code yet
	- **schema**: a named set of types, with the schemas it imports. Made with `defineSchema`
- the world is closed and strict: every node matches a type, and nothing undeclared is allowed. So the lint is objective
	- when the world does not hold a need, the ontology grows. The check does not loosen
- how schemas combine
	- dependency: a schema depends only downward. The graph has no cycles
		- test: "to understand this, what else must I understand?" Every answer points down
		- a cycle is fixed by a merge, or by a third piece both sit on
	- namespace: each name has one owner. Others refer to it, and never define it again
		- the same word in two schemas is two things (`shopify:product`, `odoo:product`)
		- outside copies of one thing link to it (the crosswalk pattern), and are not a second definition
	- extend, never override: a type can extend an imported type, and cannot change it
	- interface and implementation: others depend on what a schema exposes, never on its insides
- check: what makes a definition the source of truth. Without it, a definition is documentation and drifts

## Lint

- a linter checks definitions against rules without running anything. In: notes. Out: a list of problems. It changes nothing
- its rules come in layers, each one on the one before
	- shape: the file parses, the frontmatter is valid YAML
	- schema: the fields match the type (zod)
	- reference: each link resolves, to a thing of the right type
	- graph: no cycles, one owner per name, imports only down. `defineSchema` refuses these when a schema is built, before any note is read
	- convention: the rules each schema brings (the ESLint model: a small core, rules from plugins). Not in the code yet: a package that needs its own rules runs them beside basis's lint, as cc does
- each rule has a severity, and a schema sets it per rule: error, warning or off. Not in the code yet: today every problem is an error
	- error: the note is wrong. The check fails, and so does CI
	- warning: the note is valid but maybe not complete ("fabric has no outside copy yet"). It is reported, and the check passes
	- the schema only says valid or not. Severity lives in the lint, on top of it
	- prior art: ESLint (`off`, `warn`, `error`), SHACL (`Violation`, `Warning`, `Info`)
- lint, test and eval are three checks, not one
	- lint: definitions, static
	- test: code, run
	- eval: an agent, run, graded on the end state
- parse, don't validate (Alexis King): zod turns raw frontmatter into a typed value. After the lint passes, code downstream trusts the shape
- one linter, not one per subgraph: separate linters drift, and none can check an edge that crosses subgraphs
- front ends call the core (`lint`, `lintFolder`)
	- que, which supplies basis to the folders it mounts and checks them
	- the CLI, `basis lint [folder]`, for a person, a hook and CI. It reads `basis.config.ts` (or `.js`) at the root of the folder: the schema, and the paths to skip. It gives each problem by its path from where it runs, and exits 0 when every note fits, 1 when one does not, and 2 when it cannot check. A `.ts` config needs Node 22.18 or later, which strips types
	- not in the code yet: an Obsidian plugin on save

## Foundation

- Node and TypeScript, strict, ESM
- zod 4 for the schemas
	- `z.object({...}).strict()`: a closed type
	- `.extend()`: a type on another
	- `z.infer`: the TypeScript type, for free
	- `z.toJSONSchema`: the schema, for other tools
- `yaml` to read frontmatter
- vitest for tests
- npm workspaces, once there are several packages
- a dev container. No npm on the host

## Components

1. primitives: `defineType`, `extendType`, the links `one`, `oneOrNone`, `many` and `manyOrNone`, and `defineSchema`. The vocabulary as code
	- `defineSchema` is also the compiler: a schema and its imports become one ontology. It refuses cycles, two schemas of one name and two owners of one type name
	- what makes basis more than a zod wrapper: where schemas become one graph
	- prior art: NixOS module merging
2. loader: a folder in, notes out (path, frontmatter, body). A `skip` option leaves out the paths that are not notes, such as a README or code
3. lint: a schema and the notes in, problems out, through the rule layers
4. cli: `basis lint [folder]`, the lint run on a folder with the schema and skip of its config. The one command a person, a hook and a pipeline run
