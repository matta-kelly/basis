# basis

The base package for semantic subgraphs: the meta primitives, the compiler and the lint core that every subgraph imports.

## Check

Node runs in a dev container, never on the host. `just check` makes the container if there is none, then runs the check set: types, lint, format and tests. The pipeline runs the same file, `scripts/check.sh`.

`just run <command>` runs any other command in the container, such as `just run npm install zod`.
