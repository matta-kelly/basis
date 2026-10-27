---
type: moc
description: "basis: the root package for semantic subgraphs. The primitives, the compiler and the lint core that every subgraph imports. Read for what basis is and what it is made of."
status: active
---
Code defines, markdown describes, and the lint checks that they agree --> a tool that checks notes and code against rules, where each package brings its own rules and builds on others
- [[#Thesis]] why an ontology, and what a subgraph is
- [[#Seam]] what code holds, what markdown holds, where nodes come from, and how they meet
- [[#Primitives]] the vocabulary, and the rules for how schemas combine
- [[#Lint]] what a linter is, and the layers of its rules
- [[#Foundation]] the language and the libraries
- [[#Components]] the parts of basis, in the order they depend on each other

---
## Thesis

- define small pieces that build only downward, and check reality against them
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

## Seam

Code defines, markdown describes, and the lint checks that they agree.

- type: a kind of thing, defined once in code, as zod in `defineType`: its properties, its links, and a one-line description. It says what a valid thing of that kind is
- node: one actual thing of a type: its name, its fields, and its links to other nodes by name
- markdown: the documentation layer. A note explains a thing: what it is, why, and when to use it
	- a thing that is only written, such as an issue or a decision, has its note as its one form. The note is its node, and its frontmatter holds its fields
	- a thing that lives in code, such as a plugin, gives a piece of its node from code, by a source. Its note, of the same name, is another piece of the same node: the note gives the prose, and the facts the code does not hold. The lint merges the pieces into one node ([[#Primitives]], merge)
- one fact, one place: each field of a node comes from one piece, in code or in a note. A field that two pieces give is a problem. A copy that is kept on purpose, such as a type note's description, is checked to be the same
- source: where pieces come from. The notes of a folder are basis's own source. A config can name more, each a function that gives pieces, such as a package's reader of its things in code. basis reads no code itself: the package that knows a thing's shape reads it
	- a source gives `{ pieces, problems, unread }`, as the loader gives a folder. A source of a config gives pieces, not notes: every note is the loader's, read from the folder that holds it. Each path is from the folder linted, and is not a note's path. A link is the name of the node it points at. Its problems are only what it cannot read (`fatal`): a check of what it read is a rule
	- it gives no piece of type `type`: a type note is a note, in the folder its schema declares
	- a source that throws, or gives another shape, is at fault, not a piece: the lint throws, naming it
- one graph, one linter: every node, from every source, goes into one graph, and is checked against its type, each link against the type it points at, and the rules of each schema. A node is of a type the schema sees, whatever its source: the world stays closed
- type note: the documentation of a type, as a docstring is the documentation of a function
	- one per type, of type `type`, with the type's name as its file name. `type` is built into basis, and every schema sees it without an import
	- it sits in the folder its schema declares: `defineSchema({ ..., typeNotes: new URL("./types/", import.meta.url) })`. basis's own type note is `types/type.md`, in its package
	- its description is a copy of the type's description, and `abstract: true` is on it when the type is abstract. Each is kept in the note on purpose, as a person or an agent who opens the note reads its description first. The lint checks that each is the code's
	- an extension is the type it extends: its type note is the one of the schema that owns that type
	- its body says what the type is for, and when to use it over another. It is the template for a new node of that type
- package: an npm package. It exports a schema and its type notes, and imports the schemas it builds on
- the words are those of the property graph (PG-Schema): node, type, property, link, schema, abstract type. Content collections (Astro) use other words for the same parts: a type is a collection, a node is an entry, and a link is a `reference()`

## Primitives

- the vocabulary: what a subgraph is made of. Each one is in `src/primitives.ts`, and this section says what it means
	- **node**: one actual thing, made of one or more pieces
		- every node has what PG-Schema gives every node: an identity, its `name`, a slug as the open standards take one (lowercase letters and digits, with single hyphens between them), which no two nodes share (a note's is its file name); a label, its `type`, the name of its type; and a property, its `description`
		- in code these are the fields of `node`, the abstract parent of every type, which every type inherits unlisted
	- **piece**: what one source gives of a node: a note, whose frontmatter holds its fields, or a piece a source gives. Each piece has the node's name, names the node's type, and gives some of its fields
	- **merge**: the pieces of one name are one node, as the Nix module system merges the definitions of an option, and GraphQL federation merges the fields of an entity from its subgraphs
		- the pieces of a name all name one type, and each comes from another source: a source gives each name once, as a folder holds one note of a name. Otherwise they are not one node: each piece is a node of its own, and they share a name (`basis/unique-name`)
		- each field comes from one piece. A field that two pieces give is a problem on each of them, which names the other (`basis/merge`). No piece overrides another, and none has a priority: one fact, one place
		- the node is its fields, from every piece, checked against its type as one. A field its type needs and no piece gives is missing; a field set to undefined is not given. So a note whose code piece is gone has a problem: the fields the code gave are missing
		- the order of the pieces does not change the node, or its problems, or their order
		- a thing a source found and could not read may be a piece of the node of its name, so it is no second node. A note the loader could not read, beside a node with a note of its name, is a second note of that name (`basis/unique-name`)
		- each piece writes its links in its own syntax: a note `"[[name]]"`, a source the name
		- a problem of a field is on the piece that gives the field. A problem of the whole node is on its note, or, with no note, on its first piece by path
	- **type**: a kind of node, with its fields beside those every node has. Made with `defineType`
		- **key**: fields of a type that, together, no two of its nodes share (PG-Schema's key). A type has none unless it says
		- **parents**: the types it inherits (PG-Schema's `&`). Their fields, links and keys are its own, and a key of a parent holds over the nodes of every type that inherits it. A field two parents give differently, or one it gives again, is refused: extend, never override
		- **abstract**: a type no node is of (PG-Schema's `ABSTRACT`, GraphQL's interface). Its nodes are of the types that inherit it, and a link to it takes a node of any of them
		- **extension**: the same type, under its name, with more fields, in a schema that imports it (GraphQL's `extend type`). Made with `extendType`. It cannot change the fields it extends
	- **property**: a named field of a type, with a zod schema
	- **constraint**: a rule on a field, such as required, a minimum or a pattern. It is the field's zod schema, not a primitive of its own. A check over several fields, or several nodes, is a rule
	- **link**: a field of the type it starts from, whose schema records the type it points at. Its value is the name of the node it points at, as PG-Schema's edge ends at a node's identity
		- a note writes it `"[[name]]"`, quoted, as an Obsidian property writes a link. That is the syntax of markdown, not the value: the lint reads a note's links as wikilinks, by its type, and a link a note writes without `[[ ]]` is a problem. Another source gives the name
		- `Schema.parse` takes the values of the graph: a link is a name
		- one, oneOrNone, many (one or more), or manyOrNone (none, or an empty list). The lint checks each one points at a node of one of its types, or of a type that inherits one
		- a link to `node` takes a node of any type: for a link that can point at any note. A list of types is for a link whose targets mean something
		- data on a link itself is not supported yet
		- whether an absent optional link is worth a warning is a lint rule, not a schema question
	- **schema**: a named set of types, with the schemas it imports. Made with `defineSchema`
	- **built-in types**: `node` and `type`, held in the built-in schema `basis`. Every schema sees them as if it imported `basis`, as every GraphQL schema has `__Type`. They are basis's own words: no schema can define another type of their names
		- `node`: the abstract parent of every type, as GraphQL's `Node` interface. A link to it, or a rule on it, takes every node. No type lists it as a parent, and no schema extends it
		- `type`: the type of a type note. A schema can extend it. Its field `abstract` is `true` when the type the note explains is abstract, and is absent otherwise
	- **rule**: a check a schema brings, beside basis's own. Made with `defineRule`, held by a schema (`defineSchema({ rules })`), and seen by every schema that imports it, as a type is. Its name is unique in its schema, and its id is `<schema>/<name>`, as ESLint's `plugin/rule`: two schemas can each have a rule of one name
		- it runs on a type (`on`): each node of that type, or of a type that inherits it, that parsed. A rule on an extension does not run on a type that inherits the type extended: that type does not have the extension's fields
		- it gets the node, parsed by its type, and the graph: each node that parsed, its own too, by name (`get`) and by type (`all`), of a type the schema sees. It gives back what is wrong: a list of `{ field?, message }`, where `field` is a JSON Pointer into a field of its node's type, other than `name`
		- it sees the nodes linted, from every source. A type note that `lintFolder` reads from outside the folder linted is not one of them
		- a node that did not parse is not in the graph: it has its own problem, and a rule that reads it can give a second one, which goes when the first is fixed
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
	- public and private: others depend on what a schema exposes, never on its insides
- check: what makes a definition the source of truth. Without it, a definition is documentation and drifts

## Lint

- a linter checks definitions against rules without running anything. In: pieces, merged into nodes. Out: a list of problems. It changes nothing
- its rules come in layers, each one on the one before
	- shape: the source can read the thing: for a note, the file parses and the frontmatter is valid YAML
	- merge: the pieces of one name are one node, and no two of them give one field (`basis/merge`)
	- schema: the node has a type the schema sees, not an abstract one, and its fields match the type (zod) (`basis/type`, `basis/fields`). Its name is a slug, and not one of its fields (`basis/name`)
	- reference: each link resolves, to a thing of the right type (`basis/link`)
	- identity: no two nodes share a name (`basis/unique-name`), and no two nodes of a type share a key (`basis/key`)
	- graph: no cycles, one owner per name, imports only down. `defineSchema` refuses these when a schema is built, before any node is read
	- type notes: for each schema the lint sees, each type it owns has its type note in the folder it declares (`basis/type-note`), with the type's description and abstract (`basis/type-note-agrees`), and each type note there explains one of its types (`basis/type-note-type`). Each type note in the folder linted is in the folder of a schema the lint sees (`basis/type-note-folder`). `lintFolder` and the CLI read each folder from disk, by its URL, also when it is outside the folder linted, and compare folders by their real paths. A type note outside the folder linted is also checked as a note of type `type`. The in-memory `lint` reads no folder
	- convention: the rules each schema brings, made with `defineRule` (the ESLint model: a small core, rules from plugins). The lint runs the rules of every schema it sees. A rule that throws, or gives a field its node's type does not have, is a fault of the rule, not of the note: the lint throws, naming both
- a problem is `{ path, rule?, field?, message, fatal? }`, the parts of a SARIF result (`ruleId`, a location, `message`) and of ESLint's `LintMessage`
	- `path`: where the piece is, from the folder linted: a note's file, or the path a source gives
	- `rule`: the id of the rule that found it. A schema's are `<schema>/<rule>`. basis's own are a closed list under the schema name `basis`, which no other schema can take, exported as `coreRules`: `basis/name`, `basis/unique-name`, `basis/merge`, `basis/type`, `basis/fields`, `basis/link`, `basis/key`, `basis/type-note`, `basis/type-note-agrees`, `basis/type-note-type` and `basis/type-note-folder`. One id for each check a person could want on its own, as ESLint's rules and SHACL's constraint components. An id, once released, keeps its name
	- `fatal: true`, with no `rule`: the path cannot be read as a node. For a note: its frontmatter has no closing line, is not YAML, expands too far or is not a set of fields; or the file is not UTF-8, cannot be read, or is a symbolic link; or a folder cannot be read. A source gives its own, for what it cannot read. No rule can turn it off, as ESLint's fatal message (`ruleId: null`) and SARIF's tool notification
	- `field`: where in the node, as a JSON Pointer (RFC 6901), as SARIF and JSON Schema give a place in a JSON document: `/states/0`, with `~1` for a `/` in a key and `~0` for a `~`. None when the problem is the whole node. A key of one field names that field
	- `message`: what is wrong, and the fix. It does not say the field again: a field the node does not have is "Missing:", with what its type needs there
	- the CLI prints a problem as `path: field: message (rule)`, as ESLint's compact format, so an editor can open the path
- each rule has a severity, and a schema sets it per rule: error, warning or off. Not in the code yet: today every problem is an error
	- error: the note is wrong. The check fails, and so does CI
	- warning: the note is valid but maybe not complete ("fabric has no outside copy yet"). It is reported, and the check passes
	- the schema only says valid or not. Severity lives in the lint, on top of it
	- prior art: ESLint (`off`, `warn`, `error`), SHACL (`Violation`, `Warning`, `Info`)
- a type is not a check: it says what a valid thing is, and the checks apply it
	- is it the right shape: the type answers. The lint asks it of every node, ahead of time. A program asks it of one input, as the input arrives (parse at the boundary), with the same zod
	- does it do the right thing: no type can say. A test runs code, and an eval runs an agent and grades the end state
- parse, don't validate (Alexis King): zod turns raw fields into a typed value. After the lint passes, code downstream trusts the shape
- one linter, not one per subgraph: separate linters drift, and none can check an edge that crosses subgraphs. A subgraph brings its rules to it, as it brings its types
- front ends call the core (`lint`, `lintFolder`)
	- the CLI, `basis lint [folder]`, for a person, a hook and CI. It reads `basis.config.ts` (or `.js`) at the root of the folder: the schema, the paths to skip, and the sources of pieces beside the folder's notes. It gives each problem by its path from where it runs, and exits 0 when every node fits, 1 when one does not, and 2 when it cannot check. A `.ts` config needs Node 22.18 or later, which strips types
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
- published to npm as `@mku1tra/basis`, by a version tag. In lot, a workspace, a package that depends on it links basis's repo, through the export condition `@mku1tra/source`, with no build or release
- a dev container. No npm on the host

## Components

1. primitives: `defineType` (with `abstract` and `parents`), `extendType`, the links `one`, `oneOrNone`, `many` and `manyOrNone`, `defineRule`, `defineSchema`, and the built-in types `node` and `type` in the built-in schema `basis`. The vocabulary as code
	- `defineSchema` is also the compiler: a schema and its imports become one ontology. It refuses cycles, two schemas of one name, a schema named `basis` that is not the built-in one, two owners of one type name, a schema that holds a type of its own and declares no folder of type notes (`typeNotes`), two schemas it sees that declare one folder, a rule on a type it does not see, and two owners of one rule name
	- what makes basis more than a zod wrapper: where schemas become one graph
	- prior art: NixOS module merging
2. loader: basis's own source. A folder in, notes out, each a piece of a node (path, name, fields) with its body. A `skip` option leaves out the paths that are not notes, such as a README or code
3. lint: a schema and the pieces in, problems out: the pieces merged into nodes, then the rule layers, the rules of each schema it sees last. A folder's lint (`lintFolder`) reads the folder's notes and the pieces of each source it is given, and checks the type notes against the types
4. cli: `basis lint [folder]`, the lint run on a folder with the schema, skip and sources of its config. The one command a person, a hook and a pipeline run
