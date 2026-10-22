# basis

The root package for semantic subgraphs: the primitives, the compiler and the lint core that every subgraph imports.

## Install

From npm: `npm install @matta-kelly/basis`, and `import { defineSchema } from "@matta-kelly/basis"` in plain Node, 22.18 or later. A tag `v*` publishes that version, by `.github/workflows/publish.yml`.

In a workspace that holds basis's repo, as lot does, a package that depends on basis links the repo, not the registry. Its export condition `@matta-kelly/source` points at `src/`, so `node --conditions=@matta-kelly/source` runs basis as it is, with no build. The package on npm has no `src/`: the condition is only for a workspace.

## Lint a folder

`basis lint [folder]` checks the notes of a folder against the schema of its config, `basis.config.ts` (or `.js`) at its root, which exports `{ schema, skip }` by default. It also checks the type notes of each schema it sees, in the folder each schema declares with `typeNotes`. It runs the rules each schema it sees holds, made with `defineRule`. It gives a line for each problem, `path field: message (rule)`, by its path from where it runs, and exits 0 when every note fits, 1 when one does not, and 2 when it cannot check.

## Check

Node runs in a dev container, never on the host. `just check` makes the container if there is none, then runs the check set: types, lint, format and tests. The pipeline runs the same file, `scripts/check.sh`.

`just run <command>` runs any other command in the container, such as `just run npm install zod`.
