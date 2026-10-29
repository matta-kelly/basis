# it

The kinds of notes Matt keeps, as types on [basis](https://www.npmjs.com/package/@mku1tra/basis): ideas (moc, doc, sop) and things (tool, component, service, role). Each type has a type note in `types/` that says what it is for, and whose body a new note of that type starts from. `it.md` explains the layers and the ontology.

## Install

`npm install @mku1tra/it @mku1tra/basis zod`, in plain Node, 22.18 or later. basis (`^0.30.0`) and zod (`^4.6.0`) are peers: the project gives one copy of each.

## Use

The package's default export is its schema, `it`, and each type is a named export (`idea`, `thing`, `moc`, `doc`, `sop`, `tool`, `component`, `service`, `role`). Import it into the schema of a root, a folder with its own `basis.config.ts` whose schema names the folder as its notes, and lint that root:

```ts
// notes/basis.config.ts
import it from "@mku1tra/it";
import { defineSchema, type Config } from "@mku1tra/basis";

const mine = defineSchema({ name: "mine", description: "My notes.", types: {}, imports: [it], notes: new URL("./", import.meta.url) });
export default { schema: mine } satisfies Config;
```

Then `npx basis lint notes`, or `lintRoot("notes")` from `@mku1tra/basis`, which gives the problems and the graph.

Its notes (`it.md` and `types/`) ship with the package, and the lint of a schema that imports it checks them too.

## Release

From basis's repo: set the version in `it/package.json`, commit, and push a tag `it-v<version>`.
