#!/usr/bin/env bash
# The integration tests for basis's dev container. basis's container is made from
# .devcontainer/devcontainer.json through the dev container CLI, so these drive the real podman and the
# real CLI, and they check what the running machine gives: the file's settings in `podman inspect`, the
# CLI's label, the volume it names, and the install it runs.
#
# Run them on the host: `scripts/container-check.sh`, or `scripts/container-check.sh <name>...` for some of
# them, and `scripts/container-check.sh --list` to list them. They destroy and remake this checkout's
# container and its volumes, so do not run them under a session that is using the container.
#
# They are not a step of scripts/check.sh: that file runs inside the container, where podman is not, and
# its steps stay as they are. Where they cannot run they say why and exit 0: a machine with no podman
# (the pipeline's runner), or a container.
set -uo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
label="devcontainer.local_folder=$root"
# The version the machine has. The CLI names the container's volumes, so the tests hold one version, not
# whatever a later one would answer.
CLI=(npx --yes @devcontainers/cli@0.90.0)
CAP=3000000000
SHARES=256

skip() {
  echo "SKIP: $*"
  exit 0
}

[ ! -e /run/.containerenv ] && [ ! -e /.dockerenv ] ||
  skip "inside a container, where podman is not; run the container tests on the host"
for cmd in podman just jq npx; do
  command -v "$cmd" >/dev/null 2>&1 ||
    skip "the container tests need $cmd on the host; the pipeline runs scripts/check.sh with no podman and no dev container CLI"
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# --- the machine, read ---

# The id of this checkout's container, or empty. Read by the label the CLI sets by default, so nothing
# here depends on the CLI's name for it.
cid() {
  podman ps -a --filter "label=$label" --format '{{.ID}}' | head -1
}

count() {
  podman ps -a --filter "label=$label" --format '{{.ID}}' | wc -l
}

field() {
  podman inspect --format "$2" "$1"
}

# The volume the container mounts at the workspace's node_modules, as the container holds it.
node_modules_volume() {
  podman inspect --format "{{range .Mounts}}{{if eq .Destination \"$root/node_modules\"}}{{.Name}}{{end}}{{end}}" "$1"
}

# The volume name the file gives the workspace's node_modules, as the CLI resolves ${devcontainerId}.
file_volume() {
  "${CLI[@]}" read-configuration --workspace-folder "$root" --docker-path podman 2>/dev/null |
    jq -r --arg target "target=$root/node_modules" \
      '.configuration.mounts[]? | select(contains($target)) | capture("source=(?<source>[^,]+)").source' |
    head -1
}

# The call VS Code makes: the CLI for this folder, with no settings of its own, so the file's settings are
# all it has. Prints the CLI's JSON.
cli_up() {
  "${CLI[@]}" up --workspace-folder "$root" --docker-path podman "$@"
}

# Remove what this checkout holds, however it was made, so each test starts on a bare folder. A container
# first, whose mounts say which volumes are this checkout's; then the volume the file names, in case a
# container is already gone.
clean() {
  local id v
  for id in $(podman ps -aq --filter "label=$label"); do
    for v in $(field "$id" '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}'); do
      podman volume rm -f "$v" >/dev/null 2>&1 || true
    done
    podman rm -f "$id" >/dev/null 2>&1 || true
  done
  v=$(file_volume || true)
  if [ -n "$v" ]; then podman volume rm -f "$v" >/dev/null 2>&1 || true; fi
}

# --- assertions ---

fail() {
  printf '  %s\n' "$*" >&2
  return 1
}

assert_eq() {
  [ "$1" = "$2" ] && return 0
  fail "$3: expected [$1], got [$2]"
}

assert_ne() {
  [ "$1" != "$2" ] && return 0
  fail "$3: expected a value other than [$1]"
}

assert_contains() {
  case "$1" in *"$2"*) return 0 ;; esac
  fail "$3: expected to contain [$2], got [$1]"
}

# --- the behaviors ---

# Given a checkout with no container, when `just check` runs, then it leaves one container for this folder,
# and the file's settings are on it: the CPU cap, the shares, the workspace bound at its host path, the
# label off, and one volume at the workspace's node_modules.
test_check_leaves_the_files_settings_on_the_container() {
  cd "$root" || return 1
  clean
  local out id sec mounts binds
  if ! out=$(just check 2>&1); then
    fail "just check failed: $out"
    return 1
  fi
  assert_eq 1 "$(count)" "just check leaves one container for the folder" || return 1
  id=$(cid)
  assert_eq "$CAP" "$(field "$id" '{{.HostConfig.NanoCpus}}')" "the container has the file's CPU cap" || return 1
  assert_eq "$SHARES" "$(field "$id" '{{.HostConfig.CpuShares}}')" "the container has the file's CPU shares" || return 1
  binds=$(field "$id" '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}={{.Destination}} {{end}}{{end}}')
  assert_contains "$binds" "$root=$root" "the workspace is bound at its host path" || return 1
  sec=$(field "$id" '{{json .HostConfig.SecurityOpt}}')
  assert_contains "$sec" "label=disable" "the container has the file's label off" || return 1
  mounts=$(field "$id" '{{range .Mounts}}{{if eq .Type "volume"}}{{.Destination}} {{end}}{{end}}')
  assert_eq "$root/node_modules " "$mounts" "one volume, at the workspace's node_modules" || return 1
}

# Given a container made by the call VS Code makes, when `just _container` and `just run` look for it, then
# they find the CLI's container by its label: `_container` names its id, not the CLI's name for it, and a
# command runs in it.
test_the_container_is_found_by_label_not_by_name() {
  cd "$root" || return 1
  clean
  local out id found run
  if ! out=$(cli_up 2>/dev/null); then
    fail "the call VS Code makes, a bare up, failed: $out"
    return 1
  fi
  assert_eq success "$(jq -r .outcome <<<"$out")" "the bare up succeeds" || return 1
  id=$(jq -r .containerId <<<"$out")
  found=$(just _container)
  assert_eq "$id" "$found" "just _container names the container by its id" || return 1
  if ! run=$(just run node -v 2>&1); then
    fail "just run node -v failed: $run"
    return 1
  fi
  case "$run" in
    v22.*) ;;
    *)
      fail "just run node -v: expected v22 from inside the container, got [$run]"
      return 1
      ;;
  esac
}

# Given a checkout with no container, when `just up` runs, then it is the maker: it mounts the volume the
# file names, `run` and `check` reach its container, and `just down` removes it.
test_up_makes_the_container_and_run_and_check_reach_it() {
  cd "$root" || return 1
  clean
  local out id expected actual
  if ! out=$(just up 2>&1); then
    fail "just up failed: $out"
    return 1
  fi
  id=$(cid)
  if [ -z "$id" ]; then
    fail "just up left no container for the folder"
    return 1
  fi
  expected=$(file_volume)
  if [ -z "$expected" ]; then
    fail "the file names no volume for the workspace's node_modules"
    return 1
  fi
  actual=$(node_modules_volume "$id")
  assert_eq "$expected" "$actual" "up mounts the volume the file names" || return 1
  if ! out=$(just run node -v 2>&1); then
    fail "just run in the container up made failed: $out"
    return 1
  fi
  case "$out" in
    v22.*) ;;
    *)
      fail "just run node -v: expected v22 from inside the container, got [$out]"
      return 1
      ;;
  esac
  if ! out=$(just check 2>&1); then
    fail "just check in the container up made failed: $out"
    return 1
  fi
  if ! out=$(just down 2>&1); then
    fail "just down failed: $out"
    return 1
  fi
  assert_eq "" "$(cid)" "down removes the container" || return 1
}

# Given the container this change makes, when a process inside writes a file into the repo, then the file is
# owned by host uid 1000.
test_a_file_written_inside_is_owned_by_host_uid_1000() {
  cd "$root" || return 1
  clean
  local out id uid
  if ! out=$(just up 2>&1); then
    fail "just up failed: $out"
    return 1
  fi
  id=$(cid)
  podman exec -u node -w "$root" "$id" sh -c 'rm -f .uid-probe && touch .uid-probe' ||
    {
      fail "could not write .uid-probe inside the container"
      return 1
    }
  uid=$(stat -c %u "$root/.uid-probe")
  rm -f "$root/.uid-probe"
  assert_eq 1000 "$uid" "a file a process inside writes into the repo is owned by host uid 1000" || return 1
}

# Given a container made by `just up`, when the call VS Code makes runs for the same folder, then the two
# paths keep one container: the bare up returns the id `just _container` names, and one container exists.
test_one_container_for_vscode_and_just() {
  cd "$root" || return 1
  clean
  local out id_just id_vscode
  if ! out=$(just up 2>&1); then
    fail "just up failed: $out"
    return 1
  fi
  id_just=$(just _container)
  if ! out=$(cli_up 2>/dev/null); then
    fail "the call VS Code makes, a bare up, failed: $out"
    return 1
  fi
  id_vscode=$(jq -r .containerId <<<"$out")
  assert_eq "$id_just" "$id_vscode" "the bare up returns the container just _container names" || return 1
  assert_eq 1 "$(count)" "one container exists for the folder" || return 1
}

# Given a checkout whose file's install fails, when `just up` runs, then it exits non-zero and leaves no
# container for a later command to reuse, so the next check makes one and its install runs.
test_up_removes_the_container_a_failed_install_left() {
  cd "$root" || return 1
  clean
  local file="$root/.devcontainer/devcontainer.json" backup="$tmp/devcontainer.json.orig" out code id
  cp "$file" "$backup"
  trap "cp '$backup' '$file'" EXIT
  sed -i -E 's/("postCreateCommand"[[:space:]]*:[[:space:]]*)"([^"]*)"/\1"false"/' "$file"
  out=$(just up 2>&1)
  code=$?
  cp "$backup" "$file"
  assert_ne 0 "$code" "just up exits non-zero when the install fails" || return 1
  assert_eq "" "$(cid)" "a failed install leaves no container to reuse" || return 1
  if ! out=$(just check 2>&1); then
    fail "the check after a failed install failed: $out"
    return 1
  fi
  id=$(cid)
  assert_eq "$CAP" "$(field "$id" '{{.HostConfig.NanoCpus}}')" "the next check's container is the file's" || return 1
  if ! podman exec "$id" test -f "$root/node_modules/.package-lock.json"; then
    fail "the next check reused a volume with no install in it"
    return 1
  fi
}

# Given a container and the volume the file names, when `just down` runs, then it removes both; with no
# container it exits 0 and removes nothing; and `just up` after it makes a fresh container and volume and
# installs again.
test_down_removes_the_container_and_its_file_named_volume() {
  cd "$root" || return 1
  clean
  local out id1 id2 vol1 vol2 before after
  if ! out=$(just up 2>&1); then
    fail "just up failed: $out"
    return 1
  fi
  id1=$(cid)
  vol1=$(node_modules_volume "$id1")
  if ! podman volume ls --format '{{.Name}}' | grep -qx "$vol1"; then
    fail "up mounted no volume at node_modules"
    return 1
  fi
  if ! out=$(just down 2>&1); then
    fail "just down failed: $out"
    return 1
  fi
  assert_eq "" "$(cid)" "down removes the container" || return 1
  if podman volume ls --format '{{.Name}}' | grep -qx "$vol1"; then
    fail "down did not remove the volume the file names, $vol1"
    return 1
  fi
  before=$(podman volume ls --format '{{.Name}}' | sort)
  if ! out=$(just down 2>&1); then
    fail "down with no container exits 0: $out"
    return 1
  fi
  after=$(podman volume ls --format '{{.Name}}' | sort)
  assert_eq "$before" "$after" "down with no container removes nothing" || return 1
  if ! out=$(just up 2>&1); then
    fail "just up after down failed: $out"
    return 1
  fi
  id2=$(cid)
  assert_ne "$id1" "$id2" "up after down makes a fresh container" || return 1
  vol2=$(node_modules_volume "$id2")
  assert_eq "$vol1" "$vol2" "up after down mounts the volume the file names" || return 1
  if ! podman exec "$id2" test -f "$root/node_modules/.package-lock.json"; then
    fail "the fresh volume has no install in it"
    return 1
  fi
}

# Given a container made before this change, when `just down` and `just up` run, then it is not left in
# service: the container after them has the file's CPU cap.
test_a_container_from_before_this_change_is_replaced() {
  cd "$root" || return 1
  clean
  local cfg="$tmp/before-c1.json" out id
  cat >"$cfg" <<'JSON'
{
  "name": "basis-before-c1",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:22",
  "workspaceMount": "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind",
  "workspaceFolder": "${localWorkspaceFolder}",
  "runArgs": ["--userns=keep-id:uid=1000,gid=1000", "--security-opt", "label=disable"],
  "remoteUser": "node",
  "updateRemoteUserUID": false,
  "mounts": ["source=basis-node-modules-${devcontainerId},target=${containerWorkspaceFolder}/node_modules,type=volume"],
  "postCreateCommand": "true"
}
JSON
  if ! out=$("${CLI[@]}" up --workspace-folder "$root" --docker-path podman --override-config "$cfg" 2>/dev/null); then
    fail "could not make the container from before this change: $out"
    return 1
  fi
  id=$(jq -r .containerId <<<"$out")
  assert_eq 0 "$(field "$id" '{{.HostConfig.NanoCpus}}')" "the container from before this change has no cap" || return 1
  if ! out=$(just down 2>&1); then
    fail "just down failed: $out"
    return 1
  fi
  if ! out=$(just up 2>&1); then
    fail "just up failed: $out"
    return 1
  fi
  assert_eq "$CAP" "$(field "$(cid)" '{{.HostConfig.NanoCpus}}')" "the container after down and up has the file's cap" || return 1
}

# Given the repo, when its justfile and scripts are read, then no file of basis passes a container setting
# to a podman's run or create: the container is made from the file, through the CLI.
test_no_file_passes_container_settings_to_podman_run_or_create() {
  cd "$root" || return 1
  local out
  out=$(grep -rnE 'podman[[:space:]]+(run|create)' "$root/justfile" "$root/scripts" 2>/dev/null)
  assert_eq "" "$out" "no file of basis passes a container setting to a podman's run or create" || return 1
}

# Given a checkout this change made a container for, when `just check` runs, then the check passes in it:
# types, lint, format and the tests, and the container is the one the file sets.
test_the_check_passes_in_the_new_container() {
  cd "$root" || return 1
  clean
  local out step
  if ! out=$(just check 2>&1); then
    fail "just check failed: $out"
    return 1
  fi
  for step in "== types" "== lint" "== format" "== tests" "check passed"; do
    assert_contains "$out" "$step" "the check runs $step" || return 1
  done
  assert_eq "$CAP" "$(field "$(cid)" '{{.HostConfig.NanoCpus}}')" "the check ran in the container the file makes" || return 1
}

# --- the runner ---

TESTS=(
  test_check_leaves_the_files_settings_on_the_container
  test_the_container_is_found_by_label_not_by_name
  test_up_makes_the_container_and_run_and_check_reach_it
  test_a_file_written_inside_is_owned_by_host_uid_1000
  test_one_container_for_vscode_and_just
  test_up_removes_the_container_a_failed_install_left
  test_down_removes_the_container_and_its_file_named_volume
  test_a_container_from_before_this_change_is_replaced
  test_no_file_passes_container_settings_to_podman_run_or_create
  test_the_check_passes_in_the_new_container
)

if [ "${1:-}" = "--list" ]; then
  printf '%s\n' "${TESTS[@]}"
  exit 0
fi

selected=("${TESTS[@]}")
if [ "$#" -gt 0 ]; then
  selected=("$@")
fi

failed=()
for name in "${selected[@]}"; do
  if ! declare -F "$name" >/dev/null; then
    echo "no such test: $name" >&2
    exit 2
  fi
  echo "== $name"
  if (cd "$root" && "$name"); then
    echo "   ok"
  else
    failed+=("$name")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo
  echo "failed: ${#failed[@]} of ${#selected[@]}"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
echo
echo "all ${#selected[@]} container tests passed"
