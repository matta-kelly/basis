# basis

The root package for semantic subgraphs: the primitives, the compiler and the lint core that every subgraph imports.

## Install

From npm: `npm install @mku1tra/basis`, and `import { defineSchema } from "@mku1tra/basis"` in plain Node, 22.18 or later.

In a workspace that holds basis's repo, as lot does, a package that depends on basis links the repo, not the registry. Its export condition `@mku1tra/source` points at `src/`, so `node --conditions=@mku1tra/source` runs basis as it is, with no build. The package on npm has no `src/`: the condition is only for a workspace.

## Release

Set the version in `package.json`, commit, and push a tag `v<version>`. `.github/workflows/publish.yml` runs the check set and publishes it on npm by trusted publishing (no token, with provenance). Only an admin of the repo can make a version tag. A version npm has is not published again. A published version cannot change: npm unpublishes only within 72 hours.

## Lint a folder

`basis lint [folder]` checks the notes of a folder against the schema of its config, `basis.config.ts` (or `.js`) at its root, which exports `{ schema, skip, sources }` by default. Each source is a function that gives more nodes, such as a package's reader of its things in code, and they are linted with the notes as one graph. It also checks the type notes of each schema it sees, in the folder each schema declares with `typeNotes`. It runs the rules each schema it sees holds, made with `defineRule`. It gives a line for each problem, `path: field: message (rule)`, by its path from where it runs, and exits 0 when every node fits, 1 when one does not, and 2 when it cannot check.

## Check

Node runs in a dev container, never on the host. `just check` makes the container if there is none, then runs the check set: types, lint, format and tests. The pipeline runs the same file, `scripts/check.sh`.

`just run <command>` runs any other command in the container, such as `just run npm install zod`.
