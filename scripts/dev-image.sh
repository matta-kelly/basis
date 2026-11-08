#!/usr/bin/env bash
# The interface of scripts/dev-image.sh with none of its behaviour: a stub, so that each test of it
# reaches its assertion instead of a missing file, and none passes before the script is written.
# da-hammer writes the script, with inputs=(.devcontainer/devcontainer.json .devcontainer/Containerfile package-lock.json):
#   hash    the hash of the inputs at HEAD: 16 lowercase hex
#   ref     <name>@<digest> of <name>:<hash> if it exists, else of <name>:main
#   ensure  build, smoke and push <name>:<hash> only when ghcr lacks it, and print its ref
#   promote point <name>:main at <name>:<hash>, and print its ref
#   local   put <name>:<hash> in this machine's store, and print the tag
set -uo pipefail
exit 0
