#!/usr/bin/env bash
# Runs a command, such as `npm pack` or `npm publish`, on the package.json of the folder it runs in as npm should
# publish it: with no `workspaces`. The repo's root is the root of its workspaces, and a published package is none.
# npm has no way to leave a field out of what it publishes (publishConfig sets npm's config, not the manifest's
# fields), so this takes the field out with `npm pkg delete` around the command, and puts the file back as it was
# when the command ends, or fails. basis's prepublishOnly stops an `npm publish` not run through this file.
set -euo pipefail
kept=$(mktemp)
cp package.json "$kept"
trap 'cp "$kept" package.json && rm -f "$kept"' EXIT
npm pkg delete workspaces
"$@"
