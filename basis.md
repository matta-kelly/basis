---
type: moc
description: "basis: the root package for semantic subgraphs, as a state machine. Its intent; the state it checks, what a state is made of, and the invariants true of every state, each with the rule that holds it; how the lint checks them; and the code. Read for what basis is, before a change to its primitives or lint, or to find the rule that holds an invariant."
status: active
---
Code defines, markdown describes, and the lint checks that they agree --> a tool that checks notes and code against rules, where each package brings its own rules and builds on others. The terms of this note are those of [[state-machine]].
- [[#Intent]] what basis is for: why an ontology, and what a subgraph is for
- [[#Specification]] the state basis checks and what it is made of, the schema that says what a valid state is, how a state changes, and the invariants true of every state
- [[#Checking]] the lint that checks a graph against its specification, and what the rules do not yet say
- [[#Implementation]] a graph's code and notes; basis's own code: the language, the libraries, its tests, and the parts of basis in the order they depend on each other

---
## Intent

- intent: each real thing is defined once, in a closed world, and checked against its definition. Subgraphs stack by import
- define small pieces that build only downward, and check reality against them
- an ontology breaks a thing into a structure that makes sense. It gives two things
	- the parts to build systems from
	- something to check reality against: linting, evals, the definition as the source of truth (semantic IaC)
- everything is a graph. A subgraph is one piece of it, small enough to own, check and build on
- the world is closed and strict: every node matches a type, and nothing undeclared is allowed. So the lint is objective
	- when the world does not hold a need, the ontology grows. The check does not loosen
- a harness mounts the subgraphs it is given and navigates them. That is the goal: agent legibility
- the same idea exists closed (Palantir Ontology and AIP). basis is the open version: small subgraphs that stack by import and are checked by lint
- basis is PG-Schema plus schemas that import each other. Binding, connector, tool, skill and navigation are real, and belong to the packages that import basis, not to basis
- basis imports nothing. A package that imports it says so in its own note; basis keeps no map of what is built on it

## Specification

- the system modelled is a graph. Its specification is basis's schema, its implementation is the graph's code and notes, and the lint checks the one against the other
	- specification: a schema, that is the types and rules of a graph: a model of every valid graph
	- implementation: a graph's code and notes
	- conformance: the lint's check of a graph against its specification ([[basis-lint]])

### State

- state: the composed graph at one commit, linted from its root, every node merged from its pieces. Its bar: every rule holds
	- behavior: the composed graph over commits
- [[basis-graph]]: the graph and its subgraphs, relative terms: root, composed graph, outermost graph, subgraph, ground and package
- [[basis-node]]: one actual thing of a type, made of pieces (a note, a source's piece, a definition) that merge joins into one node

### Schema

- [[basis-schema]]: a named set of types with its imports, rules, notes, sources, exports and bridges; the built-in types; how schemas combine
- [[basis-type]]: a kind of node, defined once in code: its key, parents, properties, links and type note
- [[basis-rule]]: a check a schema brings, made with defineRule: what it runs on, what it gets and what it gives back

### Transition

- transition: a commit that adds, changes or deletes a type, an instance (a node of a type) or a piece of one
- basis checks states, not transitions: the lint checks one state of the graph, and never a move from one state to the next ([[#Validation]])

### Invariants

An invariant is a property true in every state. One with a rule is checked; one with "no rule yet" is a target, and can be false now. Under each is its rule, or "no rule yet" with the reason. They are grouped by what they hold true.

- **piece and node:** how a node is made
	- every piece can be read: a note parses, and its frontmatter is YAML
		- rule: a fatal problem, with no rule id ([[basis-problem]])
	- every piece names its source: a note's is `notes`, a code piece's is the source that gave it
		- rule: the lint's core (`lint`, inside the package) throws on a piece or an unread thing that names no source; the loader names `notes`, and a root's lint (`lintRoot`, the CLI) names each source
	- the pieces of one name, one type and one owner, each from another source, are one node, and each field comes from one piece. Two pieces of one source, or of two owners, are two nodes of one name
		- rule: `basis/merge`, `basis/unique-name`
	- a thing's note and its code are pieces of one node, joined by its name: the code gives what runs, the note the prose and the facts the code does not hold
		- rule: `basis/merge`, `basis/unique-name`
	- each instance that code defines is a node: it reaches the lint as a piece of its type
		- rule: a source gives the piece, and `basis/type` and `basis/fields` check it. `basis/definition-piece` fails a definition marked by `markDefinition`, in a schema's exports, that no source gives as a piece.
	- a node keeps each value as its piece gives it: a live value (a function, a zod schema) stays live, and its type describes it
		- rule: the lint's parse: plain data is copied and frozen, and any other value is kept as its piece gives it
- **type:** what a thing is
	- every node has a type the schema sees, not an abstract one, and its fields fit that type
		- rule: `basis/type`, `basis/fields`
	- each type has its type note, in its schema's folder of type notes, and each type note explains one type
		- rule: `basis/type-note`, `basis/type-note-type`, `basis/type-note-folder`
	- a type is one node: its code piece, at its type note's path, gives `description` and `abstract`, and its type note gives the prose
		- rule: `basis/merge`, over a type's code piece and its note
	- each type has one definition: code takes a thing's contract from its type, and declares no second shape of it
		- rule: `basis/one-definition`, over the exports each schema gives: an exported zod object that is no part of a type the schema sees, nor a bridge it names, fails, and so does a bridge that excuses nothing. It runs in a root's lint, not in the lint's core, which calls no code
- **name and link:** identity and relations
	- a name is a slug, and not one of its node's fields
		- rule: `basis/name`
	- no two nodes share a name, and no two nodes of a type share a key
		- rule: `basis/unique-name`, `basis/key`
	- every link resolves, to a node of the right type
		- rule: `basis/link`
- **graph and subgraph:** how layers build on basis
	- a graph stands alone: linted from its own root, it and its subgraphs pass, with nothing above it
		- rule: each repo's check lints each of its roots alone, at every push: basis's `.`, `types/` and `it/`; que's four roots; each other root by its repo's check
		- a node's links, and the rules that see it, resolve only in the composed graph of the graph that owns it: a subgraph that links up to a graph above it fails alone
			- rule: the lint, in one pass. Each piece names its owner, the schema whose ground or sources gave it ([[basis-graph]], owner): a root's lint names the schema of the place that read it; the lint's core gives a piece that names none to the schema linted, and throws on an owner it does not see. Each node is checked in its owner's composed graph: its type is one its owner sees, `basis/link` resolves each link only to a node of that graph, and only the rules of that graph's schemas run on it, each reading only that graph ([[basis-rule]]). A name or a key it shares with a node of a graph its owner does not import is a problem of its own, which names that node and its owner (`basis/unique-name`, `basis/key`)
	- a lint starts only at a root: a caller names a root, and the root decides its graph: its ground, skip, sources and imports, and where its ground ends. No caller chooses a scope, so each tool that lints a graph reads the one graph its root's own lint reads. As `tsc -p` takes no file beside a project, and a Go or Cargo build reads a module by its `go.mod` or `Cargo.toml`
		- rule: `lintRoot` and the CLI, the only lint basis exports. A root is a folder with its own `basis.config`, not in `node_modules` (an installed copy is linted only through its schema's import, and its config is never read), which gives only its schema, and that schema names the folder as its notes or its type notes; otherwise the lint refuses (a throw, exit 2), and no option turns this off. The skip and sources are the schema's (`defineSchema`), never the config's or the caller's. A folder in a root's ground is read only as that root's config's schema reads it: the root whose ground holds a folder is the first folder with its own `basis.config`, walking up from it (the folder itself, when it holds one), and none when its path has a part named `node_modules` or none is met. When a schema the lint sees names a folder as its notes or its type notes, and a root's ground holds it whose config's schema is not that schema (the same object), the lint refuses, and names the folder, that root and both schemas. The lint's core (`lint`) and the lint of a folder (`lintFolder`) are inside the package only
	- a subgraph is the same inside a graph as alone: a graph has a subgraph only through the subgraph's schema, once, and never reads its ground
		- each note has one owner: one graph's ground holds it, and a ground ends at a nested root: a folder with its own `basis.config`, as a BUILD file ends a Bazel package and a `go.mod` a Go module. Where a file lies on disk does not make it part of a graph; an import does
			- rule: a root's lint (`lintRoot`, the CLI). A ground ends at a nested root below its top: a real folder with its own `basis.config.ts` or `.js` file. A nested root is read only as a place of the lint, once, as its schema's; one that no schema the lint sees names is not read. A place is read the same in each lint that reads it, its own and one around it: the schema that names its folder, as its notes or its type notes, owns it and gives its skip and sources, and a config gives only its schema. A place is named only by the schema of the root whose ground holds it, if one does: the place itself when it holds its own config, or the first folder above it with one; the lint refuses another. The walk of a ground never enters a folder named `node_modules`, and no folder whose path has a part of that name is a root, so a config there is never read and no root's ground holds an installed package's folders: they are read only through its schema's import, as every Node tool reads an installed copy. A place that is a root reads all of its ground. A path another place reads is that place's: all of an imported schema's notes folder, and the own `.md` files of a folder of type notes that is no root. The root linted is the top: its walk ends only below it ([[basis-graph]], ground)
		- a skip leaves out only what is not a note: a file whose frontmatter has a `type` is a note, so a skip that names one fails
			- rule: `basis/skip`
		- a second copy of a subgraph's notes is two nodes of one name
			- rule: `basis/unique-name`
	- nothing is defined twice, within a subgraph or across the subgraphs of a graph: a type name has one owner, a name one node, a type one definition
		- rule: `defineSchema` (a type name), `basis/unique-name` (a name), `basis/one-definition` (a type). Two subgraphs that no graph composes are not checked against each other
	- schemas form no cycle, and imports point only down
		- rule: `defineSchema` refuses these when a schema is built
	- every push lints, from its root, the graph whose ground it changes
		- rule: no lint rule, since a push is no state. Each repo's `checks` job holds it at every push to every branch, and the ruleset on main refuses a commit whose `checks` is not green. A root's own check lints its graph; a repo whose notes are the ground of a graph above it lints that graph
	- packages are nodes, and each dependency is on a published package, by version: never a path into another repo
		- rule: a rule of the graph that holds the packages, none in basis. It reads each `package.json`: a dependency npm resolves to a place (a folder, a tarball, a git or other url), a published package used as a workspace, or a workspace with no package fails. It reads `package.json`, not code, so it does not see an import by a relative path

## Checking

- check: what makes a definition the source of truth. Without it, a definition is documentation and drifts
- a type is not a check: it says what a valid thing is, and the checks apply it
	- is it the right shape: the type answers. The lint asks it of every node, ahead of time. A program asks it of one input, as the input arrives (parse at the boundary), with the same zod
	- does it do the right thing: no type can say. A test runs code, and an eval runs an agent and grades the end state

### Conformance

- [[basis-lint]]: the lint: a linter over one graph, from pieces to problems and the graph it checked; parse, don't validate
- [[basis-lint-rules]]: the layers of the lint rules, from shape to convention, each with its rule id and its blind spots
- [[basis-problem]]: a problem the lint gives: its path, rule, field, message and fatal flag, and its severity (not built)
- [[basis-front-ends]]: the lint of a root, `lintRoot(folder)` (with `rootOf(folder)`, the root that holds a folder) and the CLI `basis lint [root]`, and its config and exit codes; an Obsidian plugin is not built

### Internal verification

- internal verification: the verification of a specification against its own properties, as TLC checks a TLA+ specification. basis has no technique for it: nothing checks a schema against properties of its own

### Validation

- validation: the check that the specification gives what the intent asks for. Does the rule set say all that "each real thing is defined once" means?
- what the rule set does not say ([[#Invariants]])
	- the invariants with no rule yet: none
	- transitions: basis checks one state of the graph, never a move from one state to the next. No rule can say what a change may do
- what basis leaves to its schemas: an invariant about what only a schema defines. The schema that owns it states it and holds it, with its own rule or by how it builds it; basis does not check it
	- a relation is stated once: one link, on one node, and its reverse comes from the graph, not from a second link. Only a schema knows that two of its links state one relation, so a schema that states a relation holds this with its own rule over the graph. A schema that states a relation twice and writes no rule is not caught
	- nothing reads what a schema writes to a bridge's shape: the schema writes it at publish only, never commits it, and has no reader of it. basis reads only the bridge's name and shape (`basis/one-definition`)
- the blind spots of a rule are gaps of conformance, under the rule they belong to ([[basis-lint-rules]])

## Implementation

- implementation: a graph's code and notes ([[#Specification]]). basis's own code is the implementation of the lint, and its tests check that code
	- two of its tests are fast-check properties of the merge: over random pieces of three names, each of whose fields one or more pieces give, the order of the pieces does not change the problems or their order; and every field two pieces give is a problem on each piece, and only those
	- a third is a fast-check property of the composed graph: over random composed graphs (a base schema, two schemas that import it and not each other, and a root that imports both, each with a rule that reads the graph; random pieces and unread things of random owners, with links between their names), the problems the root's lint gives on each schema's pieces are those of that schema's own lint, and more only where they name a piece of a schema it does not import

### Foundation

- Node and TypeScript, strict, ESM
- zod 4 for the schemas
	- `z.object({...}).strict()`: a closed type
	- `.extend()`: a type on another
	- `z.infer`: the TypeScript type, for free
	- `z.toJSONSchema`: the schema, for other tools
- `yaml` to read frontmatter
- vitest for tests
- published to npm as `@mku1tra/basis`, by a version tag. A repo that builds on basis installs it from npm by version. Inside basis's repo, `it/` links the root by its dev dependency `file:..`, and the export condition `@mku1tra/source` picks `src/`, with no build or release
- the repo holds a second package, `@mku1tra/it` in `it/`: Matt's note types ([[it]]), built on basis by version and published by its own tag, `it-v<version>`. basis does not import it, and basis's package does not ship it. The repo's check covers both
- each folder of notes in the repo is the root of one graph ([[basis-graph]], ground): the repo's root, whose notes (this note and the other notes that explain basis) are owned by `basis-notes`, a private package of the repo, never published, that imports it for their note types; `types/`, the root of the built-in schema, whose config the package does not ship; and `it/`, it's root. The repo's check lints from the repo's root, which reads each note once. basis's code imports none of them
- a dev container. No npm on the host

### Components

1. primitives: `defineType` (with `abstract` and `parents`), `extendType`, the links `one`, `oneOrNone`, `many` and `manyOrNone`, each with an optional `{ message }` (missing, not a node, of another type), with basis's message as the fallback, `defineRule`, `defineSchema`, `markDefinition`, and the built-in types `node` and `type` in the built-in schema `basis`. The vocabulary as code
	- `defineSchema` is also the compiler: a schema and its imports become one ontology. It refuses cycles, two schemas of one name, a schema named `basis` that is not the built-in one, two owners of one type name, a schema that holds a type of its own and declares no folder of type notes (`typeNotes`), two schemas it sees that declare one folder of type notes or one folder of notes (by real path, so through a symbolic link too), notes that are not a file URL, a skip that is not a function, sources that are not a list of functions, exports that are not a function, bridges that are not a list of names, a rule on a type it does not see, and two owners of one rule name
	- what makes basis more than a zod wrapper: where schemas become one graph
	- prior art: NixOS module merging
2. loader: basis's own source. A folder in, notes out, each a piece of a node (path, name, fields) of the source `notes`, with its body. Each note it could not read is of the source `notes` too, so what it gives goes to the lint's core as it is. A `skip` option leaves out the paths that are not notes, such as a README or code. It also finds the notes a skip leaves out, by their frontmatter, for `basis/skip`
3. lint: a schema and the pieces in, problems and the graph out: the pieces merged into nodes, each node checked in the composed graph of its owner, then the rule layers, the rules of each schema it sees last. Its core (`lint`) and the lint of a folder (`lintFolder`), which reads a folder's notes, the notes and sources of each schema it sees, and each folder of type notes, are inside the package. The lint merges each type note with its type's code piece
4. root: `lintRoot(folder)`, the one lint basis exports: it reads the root's config, refuses a folder that is no root, and lints the root's folder with its schema, as the lint of a folder. And `rootOf(folder)`, the root whose ground holds a folder, or none: the one walk up, which the lint uses and a tool that lints from a folder calls, so no package copies it
5. cli: `basis lint [root]`, `lintRoot` on the command line. The one command a person, a hook and a pipeline run
