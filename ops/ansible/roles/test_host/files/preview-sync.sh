#!/usr/bin/env bash
# Reconciles the running PR previews with GitHub's open pull requests. Runs as a systemd oneshot (root) from a
# 10 minute timer and from the "Preview" workflow_run webhook. Needs bash, curl, jq, docker compose, openssl, flock.
#
# - Eligible PR: open, not draft, not a bot, branch in this repo (never a fork), usable slug, both images exist.
# - Deploy: head sha differs from the running one -> recreate with a fresh database.
# - Teardown: PR closed/draft/ineligible, 3 days after the last deploy, or evicted by newer deploys (3 live at most).
#   Expired and evicted PRs are "parked" with the sha they had: they come back with a new push or a successful re-run of
#   the Preview workflow for that sha. A PR that never got a slot "waits" and takes the next free slot; it never evicts.
# - Certificates (edge /ask) are approved for live previews and for every eligible open PR; any other name on the
#   preview Caddy gets a small "no preview here" page instead of an empty 404.
# - Any GitHub API or parse failure changes nothing and exits non-zero.
# State is the containers themselves (labels, Created time) plus parked/<pr> ("<sha> <epoch>") and waiting/<pr> (a sha).
set -euo pipefail

dir=${PREVIEW_DIR:-/opt/abizeitbetrug-preview}
repo=${PREVIEW_REPO:?PREVIEW_REPO}
domain=${PREVIEW_DOMAIN:-test.abizeitbetrug.de}
prefix=${PREVIEW_IMAGE_PREFIX:-}
max=${PREVIEW_MAX:-3}
ttl=${PREVIEW_TTL_SECONDS:-259200}
http_port=${PREVIEW_HTTP_PORT:-18083}
ask_port=${PREVIEW_ASK_PORT:-18084}
pulls_url=${PREVIEW_PULLS_URL:-https://api.github.com/repos/$repo/pulls?state=open&per_page=100}
runs_url=${PREVIEW_RUNS_URL:-https://api.github.com/repos/$repo/actions/workflows/preview.yaml/runs?status=success&per_page=50}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
now=${PREVIEW_NOW:-$(date +%s)}

log() { echo "preview-sync: $*" >&2; }
cd "$dir"
mkdir -p parked waiting caddy
exec 9>"$dir/lock"
flock -n 9 || { log 'another sync is running; the timer will catch up'; exit 0; }

# GitHub's pull list is the only input. ponytail: first 100 open PRs, paginate if the repo ever has more.
fetch_pulls() {
  local code header=() auth=()
  [ -s pulls.json ] && [ -s pulls.etag ] && header=(-H "If-None-Match: $(cat pulls.etag)")
  [ -n "${PREVIEW_GH_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $PREVIEW_GH_TOKEN")
  code=$(curl -sS --max-time 30 -o pulls.new -D pulls.headers -w '%{http_code}' -H 'Accept: application/vnd.github+json' \
    "${auth[@]}" "${header[@]}" "$pulls_url") || return 1
  case $code in
    200 | 000) # 000: file:// URLs (tests) have no status line
      jq -e 'type == "array"' pulls.new >/dev/null || return 1
      mv pulls.new pulls.json
      grep -i '^etag:' pulls.headers | head -n1 | sed -E 's/^[^:]*: *//; s/\r$//' >pulls.etag || : >pulls.etag
      ;;
    304) [ -s pulls.json ] || return 1 ;;
    *) return 1 ;;
  esac
}
fetch_pulls || { log 'GitHub pull list unavailable or malformed; nothing changed'; exit 1; }

# number TAB sha TAB updated_at TAB branch, for PRs this repo may preview.
candidates=$(jq -r --arg repo "$repo" '.[]
  | select((.draft // false) == false and (.user.type // "") != "Bot" and .head.repo.full_name == $repo and .base.repo.full_name == $repo)
  | [.number, .head.sha, (.updated_at | fromdateiso8601), .head.ref] | @tsv' pulls.json)
open_numbers=$(jq -r '.[].number' pulls.json)

declare -A cand_sha cand_updated cand_slug live_sha live_host live_created
while IFS=$'\t' read -r n sha updated ref; do
  [ -n "$n" ] || continue
  [[ $n =~ ^[0-9]+$ && $sha =~ ^[0-9a-f]{40}$ && $updated =~ ^[0-9]+$ ]] || { log "skipping malformed PR entry '$n'"; continue; }
  if slug=$("$here/preview-slug.sh" "$ref" "$n" <pulls.json 2>/dev/null); then
    cand_sha[$n]=$sha cand_updated[$n]=$updated cand_slug[$n]=$slug
  else
    log "PR #$n has no preview name"
  fi
done <<<"$candidates"

# Running previews: one portal container per project, labelled by the compose file.
load_live() {
  live_sha=() live_host=() live_created=()
  local n sha host created ids
  ids=$(docker ps -aq --filter label=azb.preview.pr)
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086
  while IFS=$'\t' read -r n sha host created; do
    [[ $n =~ ^[0-9]+$ && $sha =~ ^[0-9a-f]{40}$ ]] || continue
    live_sha[$n]=$sha live_host[$n]=$host live_created[$n]=$created
  done < <(docker inspect $ids | jq -r '.[] | [.Config.Labels["azb.preview.pr"], .Config.Labels["azb.preview.sha"], .Config.Labels["azb.preview.host"],
    (.Created | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)] | @tsv')
}
load_live

teardown() { # PR number, why
  log "tearing down pv-$1 ($2)"
  docker compose -p "pv-$1" down -v --remove-orphans >/dev/null 2>&1 || log "teardown of pv-$1 failed"
}
park() { printf '%s %s\n' "$2" "$now" >"parked/$1"; }
parked_sha() { local s="" _; read -r s _ 2>/dev/null <"parked/$1" || :; printf '%s' "$s"; }

# Projects without a labelled portal (a half-failed deploy) are leftovers.
for project in $(docker compose ls -a --format json | jq -r '.[].Name | select(test("^pv-[0-9]+$"))'); do
  [ -n "${live_sha[${project#pv-}]:-}" ] || teardown "${project#pv-}" 'leftover without portal'
done

# Parked and waiting markers of PRs that are gone.
for f in parked/* waiting/*; do
  [ -e "$f" ] || continue
  grep -qx "$(basename "$f")" <<<"$open_numbers" || rm -f "$f"
done

# A successful Preview run for a parked sha that finished after it was parked (a re-run) lifts the marker. The run
# name is "Preview #<pr> <sha>" (run-name in preview.yaml). A failure here only leaves the markers as they are.
# ponytail: newest 50 successful runs, enough for a handful of PRs.
unpark_rerun() {
  local auth=() n sha at psha pat
  compgen -G 'parked/*' >/dev/null || return 0
  [ -n "${PREVIEW_GH_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $PREVIEW_GH_TOKEN")
  curl -sS --max-time 30 -o runs.json -H 'Accept: application/vnd.github+json' "${auth[@]}" "$runs_url" &&
    jq -e '.workflow_runs | type == "array"' runs.json >/dev/null || { log 'workflow run list unavailable; parked previews stay parked'; return 0; }
  while IFS=$'\t' read -r n sha at; do
    [ -f "parked/$n" ] || continue
    read -r psha pat <"parked/$n" || :
    pat=${pat:-$now} # markers from before the epoch was recorded
    if [ "$psha" = "$sha" ] && [ "$at" -gt "$pat" ]; then
      log "PR #$n: Preview workflow re-run for ${sha:0:7}, lifting its parked marker"
      rm -f "parked/$n"
    fi
  done < <(jq -r '.workflow_runs[] | select(.conclusion == "success")
    | (.display_title | capture("^Preview #(?<n>[0-9]+) (?<sha>[0-9a-f]{40})$")) as $t
    | [$t.n, $t.sha, (.updated_at | fromdateiso8601)] | @tsv' runs.json)
}
unpark_rerun

for n in "${!live_sha[@]}"; do
  if [ -z "${cand_sha[$n]:-}" ]; then
    teardown "$n" 'closed or no longer eligible'
    unset "live_sha[$n]"
  elif [ $((now - live_created[$n])) -gt "$ttl" ]; then
    teardown "$n" 'expired'
    park "$n" "${live_sha[$n]}"
    unset "live_sha[$n]"
  fi
done

image_ref() { printf '%s%s-preview:%s' "$prefix" "$1" "$2"; } # image sha
image_exists() { docker image inspect "$1" >/dev/null 2>&1 || docker manifest inspect "$1" >/dev/null 2>&1; }

# Rank what should run: 2 = new commit or new PR (newest PR activity first), 1 = running previews by last deploy,
# 0 = PRs that already found no slot (they only take free slots, they never evict).
rank=()
for n in "${!cand_sha[@]}"; do
  sha=${cand_sha[$n]}
  if [ "${live_sha[$n]:-}" = "$sha" ]; then
    rank+=("1 ${live_created[$n]} $n")
    continue
  fi
  if [ "$(parked_sha "$n")" = "$sha" ]; then continue; fi
  if image_exists "$(image_ref abizeitung-portal "$sha")" && image_exists "$(image_ref abizeitung-auth "$sha")"; then
    if [ "$(cat "waiting/$n" 2>/dev/null || true)" = "$sha" ]; then
      rank+=("0 ${cand_updated[$n]} $n")
    else
      rank+=("2 ${cand_updated[$n]} $n")
    fi
  else
    log "PR #$n: preview images for ${sha:0:7} not found (build pending, or the GHCR packages are not public)"
  fi
done
keep=() deploy=()
i=0
while read -r kind _ n; do
  [ -n "$n" ] || continue
  i=$((i + 1))
  if [ "$i" -le "$max" ]; then
    keep+=("$n")
    if [ "$kind" != 1 ]; then deploy+=("$n"); fi
  elif [ -n "${live_sha[$n]:-}" ]; then
    teardown "$n" 'evicted by newer previews'
    park "$n" "${live_sha[$n]}"
    unset "live_sha[$n]"
  elif [ "$kind" = 2 ]; then
    printf '%s\n' "${cand_sha[$n]}" >"waiting/$n" # never deployed: waits for a free slot, evicts nobody
  fi
done < <(printf '%s\n' "${rank[@]}" | sort -k1,1nr -k2,2nr)
# A preview whose image is gone and is not ranked stays as it is (still within limits above).

secret() { openssl rand -hex 32; }
failed=0
network_ok() { docker network inspect preview >/dev/null 2>&1 || docker network create --internal preview >/dev/null; }
network_ok
for n in "${deploy[@]}"; do
  sha=${cand_sha[$n]} slug=${cand_slug[$n]}
  portal_image=$(image_ref abizeitung-portal "$sha") auth_image=$(image_ref abizeitung-auth "$sha")
  log "deploying PR #$n at ${sha:0:7} as $slug.$domain"
  [ -z "${live_sha[$n]:-}" ] || teardown "$n" 'new commit'
  rm -f "parked/$n" "waiting/$n"
  for image in "$portal_image" "$auth_image"; do docker image inspect "$image" >/dev/null 2>&1 || docker pull -q "$image" >/dev/null; done || { log "pulling images for PR #$n failed"; failed=1; continue; }
  if PV_NUMBER=$n PV_SHA=$sha PV_HOST="$slug.$domain" PV_PORTAL_IMAGE=$portal_image PV_AUTH_IMAGE=$auth_image \
    PV_POSTGRES_PASSWORD=$(secret) PV_AUTH_SERVICE_SECRET=$(secret) PV_MOCK_AUTH_SECRET=$(secret) PV_SESSION_SECRET=$(secret) \
    docker compose -p "pv-$n" -f "$dir/compose.preview.yaml" --env-file /dev/null up -d --wait --quiet-pull >/dev/null 2>&1; then
    :
  else
    log "deploy of PR #$n failed"
    teardown "$n" 'failed deploy'
    failed=1
  fi
done
load_live

# Caddyfile: one block per live preview; any other name gets the "no preview" page. The edge's /ask approves live
# previews and every eligible open PR (so its link shows the page instead of a TLS error). Values were validated
# above; the host label is re-checked here.
gone_page='<!doctype html><meta charset=utf-8><title>No preview here</title><body style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1>No preview here</h1><p>No preview is running at this address. The pull request may be closed, the preview may have expired (3 days after the last push) or been replaced by newer ones (3 run at once), or it is not built yet.</p><p>Push a commit or re-run the Preview workflow on the pull request to bring it back.</p></body>'
write_caddyfile() {
  local n host hosts=() blocks=""
  for n in $(printf '%s\n' "${!live_sha[@]}" | sort -n); do
    host=${live_host[$n]}
    [[ $host == *".$domain" && ${host%".$domain"} =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || continue
    blocks+="	@pv$n host $host
	handle @pv$n {
		@internal path /internal /internal/*
		respond @internal 404
		reverse_proxy pv-$n:8080
	}
"
  done
  for n in "${!live_host[@]}"; do hosts+=("${live_host[$n]}"); done
  for n in "${!cand_slug[@]}"; do hosts+=("${cand_slug[$n]}.$domain"); done
  local valid=()
  for host in "${hosts[@]}"; do
    [[ $host == *".$domain" && ${host%".$domain"} =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] && valid+=("$host")
  done
  mapfile -t hosts < <(printf '%s\n' "${valid[@]}" | sort -u | sed '/^$/d')
  {
    printf '# Generated by preview-sync.sh. Edits are overwritten.\n{\n\tauto_https off\n}\n\n:8080 {\n\tencode zstd gzip\n%s\thandle {\n\t\theader Content-Type "text/html; charset=utf-8"\n\t\trespond `%s` 404\n\t}\n}\n\n' "$blocks" "$gone_page"
    printf '# On-demand TLS "ask" of the edge: 200 only for the hosts above.\n:8081 {\n'
    if [ "${#hosts[@]}" -gt 0 ]; then
      printf '\t@ok {\n\t\tpath /ask\n\t\tquery'
      printf ' domain=%s' "${hosts[@]}"
      printf '\n\t}\n\thandle @ok {\n\t\trespond 200\n\t}\n'
    fi
    printf '\thandle {\n\t\trespond 404\n\t}\n}\n'
  } >caddy/Caddyfile.new
  if ! cmp -s caddy/Caddyfile.new caddy/Caddyfile; then
    mv caddy/Caddyfile.new caddy/Caddyfile
    return 0
  fi
  rm -f caddy/Caddyfile.new
  return 1
}
changed=0
write_caddyfile && changed=1
export PREVIEW_HTTP_PORT=$http_port PREVIEW_ASK_PORT=$ask_port
caddy=(docker compose -p preview-caddy -f "$dir/compose.preview-caddy.yaml" --env-file /dev/null)
if ! "${caddy[@]}" ps --status running --quiet 2>/dev/null | grep -q .; then
  "${caddy[@]}" up -d >/dev/null
elif [ "$changed" = 1 ]; then
  "${caddy[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { log 'caddy reload failed'; failed=1; }
fi

# Images of previews that are gone (only the preview repositories, never "prune -a").
used=" "
for n in "${!live_sha[@]}"; do used+="${live_sha[$n]} "; done
while read -r ref; do
  [[ $ref =~ (^|/)abizeitung-(portal|auth)-preview:([0-9a-f]{40})$ ]] || continue
  [[ $used == *" ${BASH_REMATCH[3]} "* ]] || docker image rm "$ref" >/dev/null 2>&1 || :
done < <(docker image ls --format '{{.Repository}}:{{.Tag}}')

exit "$failed"
