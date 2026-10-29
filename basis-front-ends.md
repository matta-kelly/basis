---
type: doc
description: "The front ends that call the basis lint: the CLI, basis lint [folder], with its basis.config.ts and its exit codes; an Obsidian plugin is not built. Read before running the lint, writing a basis.config.ts, or reading an exit code."
status: active
---
Part of conformance in [[basis]] (Conformance): the terms are those of [[state-machine]].

- front ends call the core (`lint`, `lintFolder`)
	- the CLI, `basis lint [folder]`, for a person, a hook and CI. It reads `basis.config.ts` (or `.js`) at the root of the folder: the schema, the paths to skip, and the sources of pieces beside the folder's notes. The schema brings its own notes and sources, and its imports', so a config that names only its schema lints the whole subgraph. The config's skip and sources are for a folder that is no schema's notes or type notes: when a schema the lint sees names the folder as its notes, a skip or sources in the config are refused (exit 2), as its skip and sources are its `defineSchema`'s; when it names the folder as its type notes, they are refused too, as a folder of type notes has none. It gives each problem by its path from where it runs, and exits 0 when every node fits, 1 when one does not, and 2 when it cannot check. A `.ts` config needs Node 22.18 or later, which strips types
	- not built: an Obsidian plugin on save
