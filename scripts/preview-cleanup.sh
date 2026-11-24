#!/usr/bin/env bash
# Housekeeping for PR previews on GitHub's side, with the gh CLI (GH_TOKEN, GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER).
#   close <pr>  mark the PR's preview deployments inactive: the "View deployment" button goes away
#   sweep       mark preview deployments older than the preview TTL inactive; delete preview image versions
#               (GHCR) older than the TTL plus a day, so the registry does not grow with every push
# A preview whose image was deleted comes back by re-running the Preview workflow (it rebuilds the image).
# ponytail: the newest 100 deployments and image versions per run; a daily run keeps up unless there are more pushes than that per day.
set -euo pipefail

repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY}
owner=${GITHUB_REPOSITORY_OWNER:?GITHUB_REPOSITORY_OWNER}
ttl_days=${PREVIEW_TTL_DAYS:-3}
now=${PREVIEW_NOW:-$(date +%s)}

inactivate() { # deployment id
  gh api -X POST "repos/$repo/deployments/$1/statuses" -f state=inactive >/dev/null
}
deployments() { gh api -X GET "repos/$repo/deployments" -F per_page=100 "$@"; }

case ${1:-} in
close)
  pr=${2:?pull request number}
  [[ $pr =~ ^[0-9]+$ ]] || { echo 'preview-cleanup: bad PR number' >&2; exit 2; }
  for id in $(deployments -f environment="preview/pr-$pr" | jq -r --arg env "preview/pr-$pr" '.[] | select(.environment == $env) | .id'); do
    inactivate "$id"
  done
  ;;
sweep)
  cutoff=$((now - ttl_days * 86400))
  for id in $(deployments | jq -r --argjson cutoff "$cutoff" '.[]
    | select((.environment | startswith("preview/")) and (.created_at | fromdateiso8601) < $cutoff) | .id'); do
    [ "$(gh api "repos/$repo/deployments/$id/statuses" | jq -r '.[0].state // ""')" = inactive ] || inactivate "$id"
  done
  cutoff=$((now - (ttl_days + 1) * 86400))
  for name in abizeitung-portal-preview abizeitung-auth-preview; do
    # No package yet (404) is fine; anything else (403: the token may not manage the package) must fail the run.
    versions=$(gh api "users/$owner/packages/container/$name/versions?per_page=100" 2>&1) || {
      grep -q 'HTTP 404' <<<"$versions" && { echo "preview-cleanup: no package $name yet"; continue; }
      echo "preview-cleanup: listing $name failed: $versions" >&2
      exit 1
    }
    for id in $(jq -r --argjson cutoff "$cutoff" '.[] | select((.created_at | fromdateiso8601) < $cutoff) | .id' <<<"$versions"); do
      gh api -X DELETE "users/$owner/packages/container/$name/versions/$id" >/dev/null
    done
  done
  ;;
*)
  echo 'usage: preview-cleanup.sh close <pr> | sweep' >&2
  exit 2
  ;;
esac
