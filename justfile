# basis commands. Node runs in the workspace's tools member, never on the host: crate makes the workspace from
# crate.toml.

# List the commands
default:
    @just --list

# Run the check set: types, lint, format, tests, the notes and the packages. The server's check runs the same file.
check: up
    crate run scripts/check.sh

# Run a command in the workspace, from the repo folder: `just run npm install zod`
run +command: up
    @crate run {{command}}

# Make this checkout's workspace, or start what stopped. A second up changes nothing.
up:
    @crate up

# Remove this checkout's workspace: its containers, volumes and network.
down:
    @crate down
