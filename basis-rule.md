---
type: doc
description: "A rule that a schema brings, made with defineRule: the nodes it runs on, what it gets (the parsed node and the graph) and what it gives back. Read before writing a defineRule, or to know what a rule can see."
status: active
---
Part of the schema in [[basis]] (Schema): the terms are those of [[state-machine]].

- **rule**: a check a schema brings, beside basis's own. Made with `defineRule`, held by a schema (`defineSchema({ rules })`), and seen by every schema that imports it, as a type is. Its name is unique in its schema, and its id is `<schema>/<name>`, as ESLint's `plugin/rule`: two schemas can each have a rule of one name
	- it runs on a type (`on`): each node of that type, or of a type that inherits it, that parsed, whose owner is its schema or a schema that imports it ([[basis-graph]], owner). A rule on an extension does not run on a type that inherits the type extended: that type does not have the extension's fields
	- it gets the node, parsed by its type, and the graph: each node that parsed, its own too, by name (`get`) and by type (`all`), of a type the node's owner sees. It gives back what is wrong: a list of `{ field?, message }`, where `field` is a JSON Pointer into a field of its node's type, other than `name`
	- it sees the composed graph of the owner of the node it runs on: the nodes of that schema and of each schema it imports, from every source, type notes too, each read by the type that schema sees. It sees no node above that owner. So a rule of a type-only subgraph runs on the nodes of its types that a graph above holds, and reads that graph
	- a node that did not parse by its owner's type is not in the graph: it has its own problem, and a rule that reads it can give a second one, which goes when the first is fixed. A node that parsed is in the graph of its owner and of each graph above it, read by the type that graph sees: the same type, or an extension of it, which a node of the type always fits ([[basis-type]], extension)
