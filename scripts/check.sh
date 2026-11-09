#!/usr/bin/env bash
# The check set of this repo. `just check` and the pipeline both run this file, so green means the same in both places.
#
#   scripts/check.sh          the sets the change touched. On main in the pipeline, every set
#   scripts/check.sh all      every set
#   scripts/check.sh <set>    one set
#   scripts/check.sh --plan   print the sets the change needs, and run none
#
# The three parts below are basis's. The rest is the template's (kinetic, templates/repo).
# Runs where Node is: in the dev container, or in a pipeline job.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. The sets, cheapest first. The first failure ends the run.
sets="notes code"

# 2. Each set's commands.
# A pipeline log is read after the run, so it names each test. A terminal gets one dot per test.
reporter="dot"
[ -z "${CI:-}" ] || reporter=verbose

# The repo's notes, from its root: basis's notes and type notes, and it's through its import, each read once. Each root
# also passes alone, not only through the import of `.`: another graph can import it alone.
set_notes() {
  node --conditions=@mku1tra/source src/bin.ts lint . &&
    node --conditions=@mku1tra/source src/bin.ts lint types &&
    node --conditions=@mku1tra/source src/bin.ts lint it
}
# The code: types, lint, format, tests, and the packages as npm would install them.
set_code() {
  npx tsc --noEmit &&
    npx eslint &&
    npx prettier --check . &&
    npx vitest run --reporter="$reporter" &&
    scripts/install-check.sh &&
    scripts/dev-image.test.sh
}

# 3. The sets a changed file needs. A file no rule names needs every set, so a missing rule runs more, never less.
sets_for() {
  case "$1" in
    # The notes set reads every note. prettier skips Markdown (.prettierignore), so the code set reads none.
    *.md) echo notes ;;
    *) echo all ;;
  esac
}

# The files the change touched against the base: each commit since it left it, what is not committed yet, and what is
# not tracked yet. A renamed file counts at both of its paths.
changed() {
  local from
  from=$(git merge-base "${CHECK_BASE:-origin/main}" HEAD) || return 1
  git diff --name-only --no-renames "$from" || return 1
  git ls-files --others --exclude-standard
}

# Every set, when it cannot tell what changed, when nothing did, or on main in the pipeline: the full run that catches
# what a skip missed.
plan() {
  local files file need=""
  if [ "${GITHUB_REF:-}" = refs/heads/main ] || ! files=$(changed 2>/dev/null) || [ -z "$files" ]; then
    echo "$sets"
    return
  fi
  while IFS= read -r file; do
    need="$need $(sets_for "$file")"
  done <<<"$files"
  case " $need " in
    *" all "*)
      echo "$sets"
      return
      ;;
  esac
  local set out=""
  for set in $sets; do
    case " $need " in *" $set "*) out="$out $set" ;; esac
  done
  echo "${out# }"
}

# Packages, from the lockfile and frozen. A copy of each package.json and of the lockfile inside node_modules
# says what they came from, so a stale install is made again and a current one is left alone.
install() {
  local stamp=node_modules/.installed-from
  if cat package.json it/package.json basis-notes/package.json package-lock.json | cmp -s - "$stamp" &&
    [ ! node_modules/.package-lock.json -nt "$stamp" ]; then
    echo "node_modules matches the package.json files and the lockfile"
    return
  fi
  npm ci || return 1
  cat package.json it/package.json basis-notes/package.json package-lock.json >"$stamp" || return 1
}

case "${1:-}" in
  "") todo=$(plan) ;;
  all) todo=$sets ;;
  --plan)
    plan
    exit 0
    ;;
  *)
    case " $sets " in
      *" $1 "*) todo=$1 ;;
      *)
        echo "usage: scripts/check.sh [all|--plan|$(echo "$sets" | tr ' ' '|')]" >&2
        exit 2
        ;;
    esac
    ;;
esac

install
for set in $todo; do
  echo "== $set"
  "set_$set" || {
    echo "check failed at: $set" >&2
    exit 1
  }
done
echo "check passed"
