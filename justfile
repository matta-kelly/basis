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

# Stub for the container tests, which are written before the maker is built: it is the old private `_up`,
# and this change replaces it with the dev container CLI call, with no setting passed by `just`.
# The maker: the dev container, made if there is none, and started.
up: _up

# The dev container, made if there is none, and started. The same settings as .devcontainer/devcontainer.json,
# so VS Code's "Reopen in Container" and `just` give the same toolchain.
_up:
    #!/usr/bin/env bash
    set -euo pipefail
    c=$(just _container)
    if [ -z "$c" ]; then
        # One container and one node_modules volume per checkout, named by a short hash of its path, so a worktree
        # never shares them with another checkout.
        id=$(printf '%s' "{{root}}" | sha256sum | cut -c1-12)
        c=basis-dev-$id
        podman run -d --name "$c" -l "devcontainer.local_folder={{root}}" \
            --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable \
            --mount "type=bind,source={{root}},target={{root}}" \
            --mount "type=volume,source=basis-node-modules-$id,target={{root}}/node_modules" \
            mcr.microsoft.com/devcontainers/javascript-node:22 sleep infinity >/dev/null
        podman exec -u root "$c" chown node:node "{{root}}/node_modules"
    else
        podman start "$c" >/dev/null
    fi

# Remove this checkout's dev container and its node_modules volume: run before the worktree is removed.
down:
    #!/usr/bin/env bash
    set -euo pipefail
    id=$(printf '%s' "{{root}}" | sha256sum | cut -c1-12)
    podman ps -aq --filter "label=devcontainer.local_folder={{root}}" | xargs -r podman rm -f >/dev/null
    podman volume rm -f "basis-node-modules-$id" >/dev/null

_container:
    @podman ps -a --filter "label=devcontainer.local_folder={{root}}" --format '{{{{.Names}}' | head -1
