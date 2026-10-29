---
type: doc
description: "The basis lint as a linter: pieces in, problems and the checked graph out; one graph and one linter for every subgraph; parse, don't validate. Read to know what the lint gives back, or why one linter checks the whole composed graph."
status: active
---
Part of conformance in [[basis]] (Conformance): the terms are those of [[state-machine]].

- conformance: the verification of a graph's code and notes against its specification ([[basis#Specification]]). It is the lint, over the composed graph, from its root
	- a lint starts only at a root: `lintRoot(folder)`, or the CLI on it, the one lint basis exports. The root decides what is read: the schema of its config, with that schema's skip, sources and imports ([[basis#Invariants]], a lint starts only at a root). The core below, pieces in and problems out, is inside the package
	- a linter checks definitions against rules without running anything. In: pieces, merged into nodes. Out: a list of problems, and the graph it checked. It changes nothing
		- the graph (`{ problems, graph }`, as zod's `safeParse` gives the data with its error) is the one a rule reads: each node that parsed, by its name (`get`) and by its type (`all`), with each value as its piece gives it. A program runs on it once the problems are none, so the lint and the program read one graph
	- one graph, one linter: every node, from every source, goes into one graph, and is checked against its type, each link against the type it points at, and the rules of each schema. A node is of a type its owner sees, whatever its source: the world stays closed
		- each node is checked in the composed graph of its owner, the schema whose ground or sources gave it ([[basis-graph]], owner), in the one pass: its type is one its owner sees, each link resolves only to a node of that graph, and only the rules of that graph's schemas run on it, each reading that graph ([[basis-rule]]). So the problems on a subgraph's pieces are those of its own lint, and more only for a name or a key it shares with a graph it does not import. The graph the lint gives is the root's
		- one linter, not one per subgraph: separate linters drift, and none can check an edge that crosses subgraphs. A subgraph brings its rules to it, as it brings its types
	- parse, don't validate (Alexis King): zod turns raw fields into a typed value. After the lint passes, code downstream trusts the shape, and reads it from the graph the lint gives
		- closed by design: code runs with the basis types themselves
