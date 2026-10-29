#!/usr/bin/env bash
# Another project installs basis as npm packs it, with no workspaces in its package.json, and lints a root with it in
# plain Node: no TypeScript, and basis in node_modules, where Node does not strip types.
# The project has its own zod, at a version other than the one basis is developed with. basis uses
# the project's zod: one copy is installed, and a property made with it is a property to basis.
# Then a project installs it with basis, each as npm packs it, and lints a note with it's schema.
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$PWD

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

scripts/published.sh npm pack --silent --pack-destination "$tmp" >/dev/null
if tar -xOzf "$tmp"/mku1tra-basis-*.tgz package/package.json | grep -q '"workspaces"'; then
  echo "basis's package.json, as npm packs it, has workspaces" >&2
  exit 1
fi
if ! grep -q '"workspaces"' package.json; then
  echo "the repo's package.json lost its workspaces" >&2
  exit 1
fi
# A publish of basis not run through published.sh stops: npm runs prepublishOnly on `npm publish` and not on
# `npm pack`, and it fails while package.json has workspaces. Through published.sh, the field is out and it passes.
# The check runs the script with `npm run`, not `npm publish --dry-run`: npm 11 refuses a dry run of a version the
# registry has already, so that check would fail on every run after a release.
set +e
out=$(npm run --silent prepublishOnly 2>&1)
code=$?
set -e
if [ "$code" -eq 0 ] || ! grep -q "package.json has workspaces" <<<"$out"; then
  echo "prepublishOnly, not run through scripts/published.sh, did not stop on workspaces" >&2
  exit 1
fi
if ! out=$(scripts/published.sh npm run --silent prepublishOnly 2>&1); then
  echo "$out" >&2
  echo "prepublishOnly through scripts/published.sh failed" >&2
  exit 1
fi
(cd it && npm pack --silent --pack-destination "$tmp" >/dev/null)
mkdir "$tmp/project" "$tmp/project/notes"
cd "$tmp/project"
echo '{ "name": "project", "private": true, "type": "module" }' >package.json
npm install --silent --no-audit --no-fund zod@4.6.6 "$tmp"/mku1tra-basis-*.tgz
if [ -e node_modules/@mku1tra/basis/node_modules/zod ]; then
  echo "basis has a zod of its own, beside the project's" >&2
  exit 1
fi

printf -- '---\ntype: source\ndescription: "Where each bake is written."\nrole: entry\n---\n' >notes/slate.md
# The type note of source, in the folder its schema declares: its prose, as its code gives its description. basis's
# own, for the type type, is in its package.
mkdir types
printf -- '---\ntype: type\n---\nA place data lives: a database, a file, an app.\n' >types/source.md
printf -- '---\ntype: source\nrole: entry\n---\n' >notes/oven.md

# A root: notes/, whose config's schema names it as its notes and gives its skip. The schema imports things, whose
# type notes are in types/.
cat >things.js <<'JS'
import * as z from "zod";
import { defineType, defineSchema } from "@mku1tra/basis";
const source = defineType({ name: "source", description: "A place data lives.", fields: { role: z.enum(["entry", "record"]) } });
export default defineSchema({ name: "things", description: "Where data lives.", types: { source }, typeNotes: new URL("./types/", import.meta.url) });
JS
printf 'import { defineSchema } from "@mku1tra/basis";\nimport things from "../things.js";\nexport default { schema: defineSchema({ name: "notes", description: "d", imports: [things], types: {}, notes: new URL("./", import.meta.url), skip: (path) => path === "README.md" }) };\n' >notes/basis.config.js
printf 'No frontmatter.\n' >notes/README.md

node --input-type=module -e '
import { lintRoot } from "@mku1tra/basis";
const { problems } = await lintRoot("notes");
console.log(problems);
if (problems.length !== 1 || !problems[0].path.endsWith("oven.md")) process.exit(1);
'

# The command, as a project runs it: npx finds basis's bin, and the config at the root names the schema. One root has
# a config in JavaScript, the other in TypeScript, which Node strips outside node_modules.
mkdir typed
cp notes/slate.md typed/
printf 'import { defineSchema, type Config } from "@mku1tra/basis";\nimport things from "../things.js";\nexport default { schema: defineSchema({ name: "typed", description: "d", imports: [things], types: {}, notes: new URL("./", import.meta.url) }) } satisfies Config;\n' >typed/basis.config.ts

set +e
out=$(npx --no-install basis lint notes)
code=$?
set -e
echo "$out"
case "$out" in *"oven.md: /description: Missing: "*"(basis/fields)") ;; *) echo "basis lint did not name oven.md" >&2; exit 1 ;; esac
case "$out" in *README.md*) echo "basis lint read a skipped path" >&2; exit 1 ;; esac
if [ "$code" -ne 1 ]; then echo "basis lint gave $code for a note that does not fit, not 1" >&2; exit 1; fi
npx --no-install basis lint typed

# it, from its tarball, on basis from its own. it's schema reads its notes and type notes in node_modules, and they fit.
mkdir "$tmp/notes-of-it" "$tmp/notes-of-it/notes"
cd "$tmp/notes-of-it"
echo '{ "name": "notes-of-it", "private": true, "type": "module" }' >package.json
npm install --silent --no-audit --no-fund zod@4.6.6 "$tmp"/mku1tra-basis-*.tgz "$tmp"/mku1tra-it-*.tgz
for copy in node_modules/@mku1tra/it/node_modules/@mku1tra/basis node_modules/@mku1tra/it/node_modules/zod; do
  if [ -e "$copy" ]; then
    echo "it has a copy of its own, beside the project's: $copy" >&2
    exit 1
  fi
done
if [ -e node_modules/@mku1tra/it/src ] || [ -e node_modules/@mku1tra/it/basis.config.ts ]; then
  echo "it's package holds its source or its config" >&2
  exit 1
fi
if [ -e node_modules/@mku1tra/basis/it ]; then
  echo "basis's package holds it" >&2
  exit 1
fi

printf -- '---\ntype: doc\ndescription: "How bread is baked."\nstatus: active\n---\n' >notes/bread.md
printf -- '---\ntype: doc\ndescription: "How cake is baked."\nstatus: running\n---\n' >notes/cake.md
printf 'import { defineSchema } from "@mku1tra/basis";\nimport it from "@mku1tra/it";\nexport default { schema: defineSchema({ name: "notes", description: "d", imports: [it], types: {}, notes: new URL("./", import.meta.url) }) };\n' >notes/basis.config.js

node --input-type=module -e '
import { lintRoot } from "@mku1tra/basis";
const { problems } = await lintRoot("notes");
console.log(problems);
if (problems.length !== 1 || !problems[0].path.endsWith("cake.md") || problems[0].field !== "/status") process.exit(1);
'

set +e
out=$(npx --no-install basis lint notes)
code=$?
set -e
echo "$out"
case "$out" in *"cake.md: /status: "*"(basis/fields)") ;; *) echo "basis lint did not name cake.md" >&2; exit 1 ;; esac
case "$out" in *bread.md* | *node_modules*) echo "basis lint failed a note that fits" >&2; exit 1 ;; esac
if [ "$code" -ne 1 ]; then echo "basis lint gave $code for a note that does not fit, not 1" >&2; exit 1; fi
cd "$repo"
