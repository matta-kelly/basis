---
type: doc
description: "The front ends that call the basis lint: lintRoot(folder), with rootOf(folder) to find the root that holds a folder, and the CLI, basis lint [root], with the basis.config.ts of a root and its exit codes; an Obsidian plugin is not built. Read before running the lint, writing a basis.config.ts, or reading an exit code."
status: active
---
Part of conformance in [[basis]] (Conformance): the terms are those of [[state-machine]].

- front ends lint a root: a folder with its own config, `basis.config.ts` (or `.js`), which exports `{ schema }` by default and gives nothing more. The schema names the folder as its notes or its type notes, and gives its skip and sources in its `defineSchema`, and its imports bring their own notes and sources, so the config lints the whole subgraph. A lint starts nowhere else ([[basis#Invariants]], a lint starts only at a root)
	- `lintRoot(folder)`, for a program: it gives `{ problems, graph }`, each problem by its path from the root, and throws when it cannot check: the folder is in `node_modules` (an installed copy, linted through its import), has no config, its config gives more than its schema, its schema names the folder as neither its notes nor its type notes, a schema it sees names a folder that a root's ground holds (the folder's own config, or the first one above it) and is not that root's config's schema, or its schema does not hold
	- the CLI, `basis lint [root]`, for a person, a hook and CI: `lintRoot` on the folder given, or the folder it runs in. It gives each problem by its path from where it runs, and exits 0 when every node fits, 1 when one does not, and 2 when it cannot check, with the reason. A `.ts` config needs Node 22.18 or later, which strips types
	- `rootOf(folder)`, for a program that has a folder and not its root: the root whose ground holds the folder, by its real path, as the lint finds it ([[basis-graph]], ground), or none (no config is met, or the real path has a part named `node_modules`). It finds the root to give `lintRoot`; it lints nothing
	- not built: an Obsidian plugin on save
