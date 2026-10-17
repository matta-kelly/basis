#!/usr/bin/env bash
# Another project installs basis as npm packs it, and lints a folder of notes with it in plain Node:
# no TypeScript, and basis in node_modules, where Node does not strip types.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

npm pack --silent --pack-destination "$tmp" >/dev/null
mkdir "$tmp/project" "$tmp/project/notes"
cd "$tmp/project"
echo '{ "name": "project", "private": true, "type": "module" }' >package.json
npm install --silent --no-audit --no-fund "$tmp"/basis-*.tgz

printf -- '---\ntype: source\ndescription: "Where product information is typed."\n---\n' >notes/sheets.md
printf -- '---\ntype: source\n---\n' >notes/elm.md

node --input-type=module -e '
import { defineType, definePackage, lintFolder } from "basis";
const source = defineType({ name: "source", description: "A place data lives.", properties: {} });
const pkg = definePackage({ name: "things", description: "Where data lives.", types: [source], links: [] });
const problems = await lintFolder(pkg, "notes");
console.log(problems);
if (problems.length !== 1 || !problems[0].path.endsWith("elm.md")) process.exit(1);
'
