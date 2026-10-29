---
type: doc
description: "basis's graph and its subgraphs: root, composed graph, outermost graph, subgraph, ground and package, the relative terms every lint runs in. Read to know what one lint reads as one graph, or where one package's notes end and another's begin."
status: active
---
Part of the state in [[basis]] (State): the terms are those of [[state-machine]].

- the graph and its subgraphs are relative terms: the graph is the one linted from its root, and its subgraphs are what it imports
	- root: the graph a lint starts from: its schema, and the folder of its notes
	- composed graph: the graph of a root and every subgraph it imports, joined into one graph
	- owner: the schema whose ground or sources gave a piece, and so the node it is a piece of. In a folder's lint, the schema of the place that read it: the folder linted is the root's, an imported schema's notes folder and sources are that schema's, and a folder of type notes is the schema's that declares it. The folder linted, when a schema names it as its notes or its type notes, is that schema's, so a place has one owner in its own lint and in one around it. A node is checked in the composed graph of its owner, not of the root: its links resolve there, and the rules that run on it read only that graph ([[basis-lint]], [[basis-rule]])
	- outermost graph: a graph that no other graph imports
	- subgraph: a package, with its notes, its types (made with basis, on zod), and a `package.json` that names what it depends on
		- in code, a subgraph is its schema: its types and rules, its notes and its sources, and the schemas it imports
		- type-only subgraph: a subgraph whose schema declares no notes folder. It defines kinds of nodes and holds none: the nodes of its types are in the ground of a graph that imports it
		- a subgraph is not a repo. A repo is a store: one repo can hold a type-only subgraph and notes of a graph above it, kept apart only so that they stay private
			- one repo can hold the roots of more than one graph, each a folder with its own config, as basis's repo does ([[basis#Foundation]])
		- npm gives versions, resolution and install. No own package format
		- the lint of a schema is the lint of its subgraph: it and every schema it imports, as one graph (composed graph, above)
		- ground: the part of a folder that a graph reads as its own notes: its schema's notes folder, less its skip, less each nested root below its top, and less each path another place reads
			- nested root: a real folder below the top of a ground that holds its own `basis.config.ts` or `.js` file. A ground ends at a nested root, as a BUILD file ends a Bazel package and a `go.mod` a Go module: the lint reads it only as one of its places, and a skip need not name it. The folder linted is the top: its ground ends only below it
			- a path another place reads is that place's, read once: all of an imported schema's notes folder, and the own `.md` files of a folder of type notes that is no root. A folder of type notes that is a root is read by all of its ground, as its own lint reads it, so each note under it has an owner
		- package: an npm package. It exports a schema, which names its notes, its type notes and its sources, and imports the schemas it builds on. It ships the folders its schema names, so a package that imports it lints them
			- a package inside another's folder is set apart by its import and by its root: the folder of an imported schema is that schema's, read once, by its skip and with its sources. A nested root that no schema the lint sees names is not read: a graph has a subgraph only through its import ([[basis#Invariants]], graph and subgraph)
