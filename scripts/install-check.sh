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

printf -- '---\ntype: source\ndescription: "Where product information is typed."\nrole: entry\n---\n' >notes/sheets.md
printf -- '---\ntype: source\nrole: entry\n---\n' >notes/elm.md

node --input-type=module -e '
import * as z from "zod";
import { defineType, defineSchema, lintFolder } from "basis";
const source = defineType({ name: "source", description: "A place data lives.", fields: { role: z.enum(["entry", "record"]) } });
const schema = defineSchema({ name: "things", description: "Where data lives.", types: { source } });
const problems = await lintFolder(schema, "notes");
console.log(problems);
if (problems.length !== 1 || !problems[0].path.endsWith("elm.md")) process.exit(1);
'
