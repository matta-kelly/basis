# basis

The root package for semantic subgraphs: the primitives, the compiler and the lint core that every subgraph imports.

This repo holds two packages, each published on npm by its own tag:

- `@mku1tra/basis`, at the root: basis itself
- `@mku1tra/it`, in `it/`: the kinds of notes Matt keeps, as types on basis. Its notes are its folder: `it.md` and its type notes in `types/`

and one private package, never published: `basis-notes`, in `basis-notes/`, the schema of the notes that explain basis

## Install

From npm: `npm install @mku1tra/basis`, and `import { defineSchema } from "@mku1tra/basis"` in plain Node, 22.18 or later.

A repo that builds on basis installs `@mku1tra/basis` from npm by version, as que does. Inside this repo, `it/` links basis's root by its dev dependency `file:..`, not the registry. basis's export condition `@mku1tra/source` points at `src/`, so `node --conditions=@mku1tra/source` (and tsc, by `customConditions`, and the tests, by vitest's `ssr.resolve.conditions`) runs basis as it is, with no build. The package on npm has no `src/`: the condition is only for this repo.

## Release

Set the version in the package's `package.json`, commit, and push its tag: `v<version>` for basis, `it-v<version>` for it. `.github/workflows/publish.yml` runs the check set and publishes that package on npm by trusted publishing (no token, with provenance). A ruleset lets only an admin of the repo make a version tag, of either prefix (`v*` and `it-v*`). A version npm has is not published again. A published version cannot change: npm unpublishes only within 72 hours. The repo's root is the root of its workspaces, and the package.json npm publishes has no `workspaces`: npm has no setting that leaves a field out, so `scripts/published.sh` takes it out for the command (`npm publish`, and `npm pack` in the check) and puts the file back after. A publish of basis not run through it stops: basis's `prepublishOnly`, which npm runs on `npm publish` and not on `npm pack`, fails while `package.json` has `workspaces`.

it's peer range on basis is one minor (`^0.29.0`). Each new minor of basis needs it's range moved to it, and a new release of it. basis-notes's peer ranges move with each new minor of basis and of it.

## Lint a root

A lint starts only at a root: a folder with its own config, `basis.config.ts` (or `.js`), which exports `{ schema }` by default and nothing more. The schema names the folder as its notes (`defineSchema({ ..., notes: new URL("./", import.meta.url) })`) or as its type notes, and gives its skip and sources there. `basis lint [root]` lints the root given, or the folder it runs in; a program calls `lintRoot(folder)`, which gives `{ problems, graph }`. Neither takes a skip, a source or a schema of the caller's: the root decides what is read. A folder in `node_modules` (an installed copy, linted only through its schema's import), a folder with no config, a config that gives more than its schema, or a schema that names the folder as neither its notes nor its type notes is refused: the CLI exits 2, and `lintRoot` throws. So is a schema the lint sees that names, as its notes or its type notes, a folder in another root's ground. The root whose ground holds a folder is the first folder with a config, walking up from it (the folder itself first), and none in `node_modules`. A root, and each folder in its ground, is read only as that root's config's schema reads it.

Each source is a function that gives more pieces of nodes, such as a package's reader of its things in code. The lint reads the notes, skip and sources of every schema the root's schema imports too, as one graph. A folder below with its own config is another graph's root: the lint reads it, or a folder in it, only as the notes of a schema it sees, and only as that root's config's schema. The walk never enters a folder named `node_modules`: an installed package's notes are read only through its schema's import. A skip leaves out what is not a note: a `.md` file it names whose frontmatter has a `type` is a note, and a problem (`basis/skip`). A schema can also give its package's exports (`exports: () => import("./index.ts")`), and the lint fails each exported zod object that is no part of a type the schema sees, unless the schema names it in `bridges` (`basis/one-definition`). A package's `define*` function marks what it gives with `markDefinition(value, { name, type })`, and the lint fails each marked definition in the exports of which no source gives a piece of that name and type (`basis/definition-piece`). Each piece is of the schema whose folder or source gave it, and the pieces of one name from one schema, from its notes and its sources, are merged into one node. All of them are linted as one graph, and each node in the graph of its schema and what it imports: a link resolves only to a node of that graph, and a rule runs on it and reads only that graph. It also checks the type notes of each schema it sees, in the folder each schema declares with `typeNotes`. It runs the rules each schema it sees holds, made with `defineRule`. It gives a line for each problem, `path: field: message (rule)`, by its path from where it runs, and exits 0 when every node fits, 1 when one does not, and 2 when it cannot check.

## Check

Node runs in a dev container, never on the host. `just check` makes the container if there is none, then runs the check set: types, lint, format, tests, the repo's notes from its root (`basis lint .`), and the packages, each installed from its tarball in an empty project and run in plain Node. The pipeline runs the same file, `scripts/check.sh`.

it is a workspace of the repo. It depends on basis by version (`^0.29.0`, a peer), and in the repo its dev dependency `file:..` links the root, so its check runs on basis as it is.

Each folder of notes in the repo is the root of one graph, with its own `basis.config.ts`:

- the repo's root: the notes that explain basis (`basis.md` and its `basis-*.md` notes). Their schema is `basis-notes`, a private workspace of the repo whose notes folder is the repo's root. It imports `@mku1tra/it` for their note types, by the peer dependencies `@mku1tra/basis` and `@mku1tra/it`, so a graph that imports it as a workspace gives it its own basis and it, one copy of each. it's export condition `@mku1tra/source` picks its `src/`, as basis's does
- `types/`: basis's built-in type notes. Its config's schema is the built-in schema, `basis`. The package ships `types/` but not this config
- `it/`: it's notes and type notes, with it's schema

The root's lint, `basis lint .`, reads each note once: its own, `types/` as the built-in schema's, and it's through the import. A ground ends at a nested root, so a graph that holds the repo, such as a vault with basis as a submodule, reads none of the repo's notes unless it imports `basis-notes`. The packages on npm ship neither `basis-notes` nor the notes that explain basis.

`just run <command>` runs any other command in the container, such as `just run npm install zod`.
