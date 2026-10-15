#!/usr/bin/env bash
# The check set of basis. `just check` and the pipeline both run this file,
# and neither holds a check of its own, so green means the same in both places.
# Runs where Node is: in the dev container, or in a pipeline job.
set -euo pipefail
cd "$(dirname "$0")/.."

# Packages, from the lockfile and frozen. A copy of package.json and of the lockfile inside node_modules
# says what they came from, so a stale install is made again and a current one is left alone.
install() {
  local stamp=node_modules/.installed-from
  if cat package.json package-lock.json | cmp -s - "$stamp" && [ ! node_modules/.package-lock.json -nt "$stamp" ]; then
    echo "node_modules matches package.json and the lockfile"
    return
  fi
  npm ci || return 1
  cat package.json package-lock.json >"$stamp" || return 1
}

# One step, named in the output, so a failure reads the same on a machine and in the pipeline.
step() {
  local name=$1
  shift
  echo "== $name"
  "$@" || {
    echo "check failed at: $name" >&2
    exit 1
  }
}

# A pipeline log is read after the run, so it names each test. A terminal gets one dot per test.
reporter=dot
[ -z "${CI:-}" ] || reporter=verbose

step install install
step types npx tsc --noEmit
step lint npx eslint
step format npx prettier --check .
step tests npx vitest run --passWithNoTests --reporter="$reporter"
echo "check passed"
