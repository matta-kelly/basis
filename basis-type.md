---
type: doc
description: "A basis type and its parts: key, parents, abstract, extension, property and constraint, link (its kinds, its message and its failures) and the type note. Read before writing a defineType, an extendType, a link or a type note, or to read a basis/link or basis/fields problem."
status: active
---
Part of the schema in [[basis]] (Schema): the terms are those of [[state-machine]].

- **type**: a kind of node, defined once in code, as zod in `defineType`: its properties and its links, beside those every node has, and a one-line description. It says what a valid thing of that kind is
	- one definition: code takes a thing's contract from its type, and declares no second shape of it. `basis/one-definition` holds it over what a package exports ([[basis-lint-rules]])
	- **key**: fields of a type that, together, no two of its nodes share (PG-Schema's key). A type has none unless it says
	- **parents**: the types it inherits (PG-Schema's `&`). Their fields, links and keys are its own, and a key of a parent holds over the nodes of every type that inherits it. A field two parents give differently, or one it gives again, is refused: extend, never override
	- **abstract**: a type no node is of (PG-Schema's `ABSTRACT`, GraphQL's interface). Its nodes are of the types that inherit it, and a link to it takes a node of any of them
	- **extension**: the same type, under its name, with more fields, in a schema that imports it (GraphQL's `extend type`). Made with `extendType`. It cannot change the fields it extends
		- each field it adds is one zod marks optional (`.optional()`, `oneOrNone`, `manyOrNone`): `extendType` refuses another, and the compiler too, even one a node could leave out that zod does not mark so (`z.unknown()`, a `.catch()`). So each node of the type it extends, held by a graph below, fits it, and a graph above reads that node by the extension. Adding a field a node must give to a type others hold breaks their nodes, as protobuf found of `required` ([Don't add a required field](https://protobuf.dev/best-practices/dos-donts/#add-required)). A graph that needs its own nodes to give the field says so in a rule
		- it has the key of the type it extends. When that type has none, it can add one, over that type's fields: its own fields can be left out, so no key names them
	- **property**: a named field of a type, with a zod schema
		- **constraint**: a rule on a field, such as required, a minimum or a pattern. It is the field's zod schema, not a primitive of its own. A check over several fields, or several nodes, is a rule
	- **link**: a field of the type it starts from, whose schema records the type it points at. Its value is the name of the node it points at, as PG-Schema's edge ends at a node's identity
		- a note writes it `"[[name]]"`, quoted, as an Obsidian property writes a link. That is the syntax of markdown, not the value: the lint reads a note's links as wikilinks, by its type, and a link a note writes without `[[ ]]` is a problem. Another source gives the name
		- `Schema.parse` takes the values of the graph: a link is a name
		- one, oneOrNone, many (one or more), or manyOrNone (none, or an empty list). The lint checks each one points at a node of one of its types, or of a type that inherits one
		- a link to `node` takes a node of any type: for a link that can point at any note. A list of types is for a link whose targets mean something
		- a link can carry its own message: `one(() => model, { message })`, and the same for each kind. `message` is a function of the failure and the graph, `(failure, graph) => string | undefined`, which gives the message, or undefined for basis's. The rule and the field stay basis's (SHACL's `sh:message`, zod's `error`)
			- the failure (`LinkFailure`) is one of: `missing`, a required link that gives no name (absent, or an empty list); `not-a-node`, the name is no node; `wrong-type`, the node of the name is of another type (`targetType`). Each has `node`, the name of the node the link starts from, and the last two `target`, the name it points at
			- `node` is a name, not a value: a node with a missing link did not parse. A message reads a parsed node through the graph, which is the graph a rule gets: every node that parsed, in the whole lint
			- a value that is not one name in its piece's syntax, such as a note's link without `[[ ]]`, keeps basis's message: it is the syntax of a piece, not what the link means
			- a type that inherits the link, or extends its type, has its message. The message is the lint's: `Schema.parse` gives zod's
			- a message that throws, or gives other than a non-empty string or undefined, is a fault of the link: the lint throws, naming the type, the link and the node's path
		- data on a link itself is not supported yet
		- whether an absent optional link is worth a warning is a lint rule, not a schema question
	- **type note**: the documentation of a type, as a docstring is the documentation of a function
		- one per type, of type `type`, with the type's name as its file name. `type` is built into basis, and every schema sees it without an import
		- it sits in the folder its schema declares: `defineSchema({ ..., typeNotes: new URL("./types/", import.meta.url) })`. basis's own type notes are in `types/` (`node.md`, `type.md`), in its package
		- a type is one node: its code piece, as `defineType` made it, gives its `description` and `abstract`, and its type note gives the prose. The lint adds the code piece of each type note it is given, named for a type the schema sees, at the note's path, of the source `defineType`, and merges the two by name ([[basis-node]], merge). A note that gives the description or abstract again is `basis/merge`, which names the code
		- an extension is the type it extends: its type note is the one of the schema that owns that type
		- its body says what the type is for, and when to use it over another. It is the template for a new node of that type
