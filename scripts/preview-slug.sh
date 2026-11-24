#!/usr/bin/env bash
# Prints the preview host label for a branch: <slug>.test.abizeitbetrug.de.
# Usage: preview-slug.sh BRANCH [PR_NUMBER] [< open-pulls.json]
# With PR_NUMBER and the GitHub "list open pulls" JSON on stdin, it refuses a slug another open PR already has.
# Exit 1 with the reason on stderr when the branch has no usable slug.
set -euo pipefail

branch=${1:?usage: preview-slug.sh BRANCH [PR_NUMBER]}
number=${2:-}

# Lowercase, everything outside [a-z0-9] becomes a hyphen, hyphen runs collapse, edges trim, 40 characters at most.
slug=$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | LC_ALL=C sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40 | LC_ALL=C sed -E 's/-+$//')
[ -n "$slug" ] || { echo "branch '$branch' has no usable preview name" >&2; exit 1; }
case $slug in
  test | www | hooks | mail | api | admin | auth | dev | main | preview | ask | localhost)
    echo "preview name '$slug' is reserved" >&2
    exit 1
    ;;
esac

if [ -n "$number" ] && [ ! -t 0 ]; then
  # Same slug on a different open PR of this repo (forks never get previews, so they cannot clash).
  clash=$(jq -r --argjson n "$number" --arg slug "$slug" '
    .[] | select(.number != $n and .head.repo.full_name == .base.repo.full_name)
    | select((.head.ref | ascii_downcase | gsub("[^a-z0-9]+"; "-") | sub("^-+"; "") | .[0:40] | sub("-+$"; "")) == $slug) | .number' | head -n1)
  if [ -n "$clash" ]; then
    echo "preview name '$slug' is already used by PR #$clash" >&2
    exit 1
  fi
fi
printf '%s\n' "$slug"
