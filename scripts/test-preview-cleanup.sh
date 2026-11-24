#!/usr/bin/env bash
# Invariants of preview-cleanup.sh against a fake gh: only preview deployments past the TTL (or of the closed PR) are
# deactivated, already inactive ones are left alone, only image versions older than TTL + 1 day are deleted.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
fail() { echo "FAIL: $*" >&2; exit 1; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/preview-cleanup.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
now=1800000000
day=86400
iso() { jq -rn --argjson t "$1" '$t | todate'; }
ago() { iso $((now - $1 * day)); }
jq -n --arg old "$(ago 5)" --arg new "$(ago 1)" '[
  {id:10, environment:"preview/pr-1", created_at:$old},
  {id:11, environment:"preview/pr-2", created_at:$new},
  {id:12, environment:"preview/pr-3", created_at:$old},
  {id:13, environment:"production",   created_at:$old},
  {id:14, environment:"preview/pr-1", created_at:$new}]' >"$tmp/deployments.json"
jq -n --arg d10 "$(ago 10)" --arg d5 "$(ago 5)" --arg d3 "$(ago 3)" \
  '[{id:100, created_at:$d5}, {id:101, created_at:$d3}, {id:102, created_at:$d10}]' >"$tmp/versions.json"

mkdir "$tmp/bin"
cat >"$tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"-X POST"*) echo "POST $*" >>"$GH_LOG" ;;
  *"-X DELETE"*) echo "DELETE $*" >>"$GH_LOG" ;;
  *deployments/12/statuses*) echo '[{"state":"inactive"},{"state":"success"}]' ;;
  *deployments/*/statuses*) echo '[{"state":"success"}]' ;;
  *deployments*) cat "$FIXTURES/deployments.json" ;;
  *versions*) cat "$FIXTURES/versions.json" ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/gh"
run() { : >"$tmp/log"; PATH="$tmp/bin:$PATH" GH_LOG="$tmp/log" FIXTURES="$tmp" GITHUB_REPOSITORY=o/r GITHUB_REPOSITORY_OWNER=o PREVIEW_NOW=$now bash ./preview-cleanup.sh "$@" >/dev/null; }
touched() { grep "^$1 " "$tmp/log" | grep -o 'deployments/[0-9]*\|versions/[0-9]*' | grep -o '[0-9]*$' | tr '\n' ' ' || :; }

run close 1
[ "$(touched POST)" = '10 14 ' ] || fail "close 1 touched '$(touched POST)'"
[ -z "$(grep DELETE "$tmp/log")" ] || fail 'close deleted image versions'
run close 9
[ -z "$(cat "$tmp/log")" ] || fail 'close of another PR touched something'
if run close 'x; rm' 2>/dev/null; then fail 'bad PR number accepted'; fi

run sweep
[ "$(touched POST)" = '10 ' ] || fail "sweep deactivated '$(touched POST)' (want only 10: 11 is recent, 12 already inactive, 13 is not a preview)"
[ "$(touched DELETE)" = '100 102 100 102 ' ] || fail "sweep deleted '$(touched DELETE)' (want 100 and 102 of both packages, not the 3 day old 101)"
echo 'OK: preview-cleanup'
