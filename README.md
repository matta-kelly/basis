# basis

The root package for semantic subgraphs: the primitives, the compiler and the lint core that every subgraph imports.

This repo holds two packages, each published on npm by its own tag:

- `@mku1tra/basis`, at the root: basis itself
- `@mku1tra/it`, in `it/`: the kinds of notes Matt keeps, as types on basis. Its notes are its folder: `it.md` and its type notes in `types/`

## Install

From npm: `npm install @mku1tra/basis`, and `import { defineSchema } from "@mku1tra/basis"` in plain Node, 22.18 or later.

A repo that builds on basis installs `@mku1tra/basis` from npm by version, as que does. Inside this repo, `it/` links basis's root by its dev dependency `file:..`, not the registry. basis's export condition `@mku1tra/source` points at `src/`, so `node --conditions=@mku1tra/source` (and tsc, by `customConditions`) runs basis as it is, with no build. The package on npm has no `src/`: the condition is only for this repo.

## Release

Set the version in the package's `package.json`, commit, and push its tag: `v<version>` for basis, `it-v<version>` for it. `.github/workflows/publish.yml` runs the check set and publishes that package on npm by trusted publishing (no token, with provenance). A ruleset lets only an admin of the repo make a version tag, of either prefix (`v*` and `it-v*`). A version npm has is not published again. A published version cannot change: npm unpublishes only within 72 hours.

it's peer range on basis is one minor (`^0.23.0`). Each new minor of basis needs it's range moved to it, and a new release of it.

## Lint a folder

`basis lint [folder]` checks the notes of a folder against the schema of its config, `basis.config.ts` (or `.js`) at its root, which exports `{ schema, skip, sources }` by default. Each source is a function that gives more pieces of nodes, such as a package's reader of its things in code. A schema can name its own notes, skip and sources (`defineSchema({ ..., notes: new URL("./", import.meta.url), sources })`), and the lint reads those of every schema it imports too, as one graph. A config gives skip and sources only for a folder that is no schema's notes. A schema can also give its package's exports (`exports: () => import("./index.ts")`), and the lint fails each exported zod object that is no part of a type the schema sees, unless the schema names it in `bridges` (`basis/one-definition`). The pieces of one name, from the notes and the sources, are merged into one node, and all of them are linted as one graph. It also checks the type notes of each schema it sees, in the folder each schema declares with `typeNotes`. It runs the rules each schema it sees holds, made with `defineRule`. It gives a line for each problem, `path: field: message (rule)`, by its path from where it runs, and exits 0 when every node fits, 1 when one does not, and 2 when it cannot check.

## Check

Node runs in a dev container, never on the host. `just check` makes the container if there is none, then runs the check set: types, lint, format, tests, it's notes against its schema, and the packages, each installed from its tarball in an empty project and run in plain Node. The pipeline runs the same file, `scripts/check.sh`.

it is a workspace of the repo. It depends on basis by version (`^0.23.0`, a peer), and in the repo its dev dependency `file:..` links the root, so its check runs on basis as it is.

`just run <command>` runs any other command in the container, such as `just run npm install zod`.
