#!/usr/bin/env bash
# Another project installs basis as npm packs it, and lints a folder of notes with it in plain Node:
# no TypeScript, and basis in node_modules, where Node does not strip types.
# The project has its own zod, at a version other than the one basis is developed with. basis uses
# the project's zod: one copy is installed, and a property made with it is a property to basis.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

npm pack --silent --pack-destination "$tmp" >/dev/null
mkdir "$tmp/project" "$tmp/project/notes"
cd "$tmp/project"
echo '{ "name": "project", "private": true, "type": "module" }' >package.json
npm install --silent --no-audit --no-fund zod@4.6.6 "$tmp"/basis-*.tgz
if [ -e node_modules/basis/node_modules/zod ]; then
  echo "basis has a zod of its own, beside the project's" >&2
  exit 1
fi

printf -- '---\ntype: source\ndescription: "Where each bake is written."\nrole: entry\n---\n' >notes/slate.md
# The type note of source, in the folder its schema declares. basis's own, for the type type, is in its package.
mkdir types
printf -- '---\ntype: type\ndescription: "A place data lives."\n---\n' >types/source.md
printf -- '---\ntype: source\nrole: entry\n---\n' >notes/oven.md

node --input-type=module -e '
import * as z from "zod";
import { pathToFileURL } from "node:url";
import { defineType, defineSchema, lintFolder } from "basis";
const source = defineType({ name: "source", description: "A place data lives.", fields: { role: z.enum(["entry", "record"]) } });
const typeNotes = pathToFileURL(process.cwd() + "/types/");
const schema = defineSchema({ name: "things", description: "Where data lives.", types: { source }, typeNotes });
const problems = await lintFolder(schema, "notes");
console.log(problems);
if (problems.length !== 1 || !problems[0].path.endsWith("oven.md")) process.exit(1);
'

# The command, as a project runs it: npx finds basis's bin, and the config at the folder's root names the schema.
# One folder has a config in JavaScript, the other in TypeScript, which Node strips outside node_modules.
cat >things.js <<'JS'
import * as z from "zod";
import { defineType, defineSchema } from "basis";
const source = defineType({ name: "source", description: "A place data lives.", fields: { role: z.enum(["entry", "record"]) } });
export default defineSchema({ name: "things", description: "Where data lives.", types: { source }, typeNotes: new URL("./types/", import.meta.url) });
JS
printf 'import things from "../things.js";\nexport default { schema: things, skip: ["README.md"] };\n' >notes/basis.config.js
printf 'No frontmatter.\n' >notes/README.md
mkdir typed
cp notes/slate.md typed/
printf 'import type { Config } from "basis";\nimport things from "../things.js";\nexport default { schema: things } satisfies Config;\n' >typed/basis.config.ts

set +e
out=$(npx --no-install basis lint notes)
code=$?
set -e
echo "$out"
case "$out" in *"oven.md: "*) ;; *) echo "basis lint did not name oven.md" >&2; exit 1 ;; esac
case "$out" in *README.md*) echo "basis lint read a skipped path" >&2; exit 1 ;; esac
if [ "$code" -ne 1 ]; then echo "basis lint gave $code for a note that does not fit, not 1" >&2; exit 1; fi
npx --no-install basis lint typed
