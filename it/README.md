# it

The kinds of notes Matt keeps, as types on [basis](https://www.npmjs.com/package/@mku1tra/basis): ideas (moc, doc, sop) and things (tool, component, service, role). Each type has a type note in `types/` that says what it is for, and whose body a new note of that type starts from. `it.md` explains the layers and the ontology.

## Install

`npm install @mku1tra/it @mku1tra/basis zod`, in plain Node, 22.18 or later. basis (`^0.28.0`) and zod (`^4.6.0`) are peers: the project gives one copy of each.

## Use

The package's default export is its schema, `it`, and each type is a named export (`idea`, `thing`, `moc`, `doc`, `sop`, `tool`, `component`, `service`, `role`). Lint a folder of notes with it, or import it into a schema of your own:

```ts
import it, { idea } from "@mku1tra/it";
import { defineSchema, lintFolder } from "@mku1tra/basis";

const { problems } = await lintFolder(it, "notes");
const mine = defineSchema({ name: "mine", description: "My notes.", types: {}, imports: [it] });
```

Its notes (`it.md` and `types/`) ship with the package, and the lint of a schema that imports it checks them too.

## Release

From basis's repo: set the version in `it/package.json`, commit, and push a tag `it-v<version>`.
