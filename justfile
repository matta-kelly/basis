# basis commands. Node runs in the dev container, never on the host.

root := justfile_directory()

# List the commands
default:
    @just --list

# Run the check set: types, lint, format and tests. The pipeline runs the same file.
check: _up
    podman exec -u node -w "{{root}}" "$(just _container)" scripts/check.sh

# Run a command in the dev container, from the repo folder: `just run npm install zod`
run +command: _up
    podman exec -it -u node -w "{{root}}" "$(just _container)" {{command}}

# The dev container, made if there is none, and started. The same settings as .devcontainer/devcontainer.json,
# so VS Code's "Reopen in Container" and `just` give the same toolchain.
_up:
    #!/usr/bin/env bash
    set -euo pipefail
    c=$(just _container)
    if [ -z "$c" ]; then
        podman run -d --name basis-dev -l "devcontainer.local_folder={{root}}" \
            --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable \
            --mount "type=bind,source={{root}},target={{root}}" \
            --mount "type=volume,source=basis-node-modules,target={{root}}/node_modules" \
            mcr.microsoft.com/devcontainers/javascript-node:22 sleep infinity >/dev/null
        podman exec -u root basis-dev chown node:node "{{root}}/node_modules"
    else
        podman start "$c" >/dev/null
    fi

_container:
    @podman ps -a --filter "label=devcontainer.local_folder={{root}}" --format '{{{{.Names}}' | head -1
