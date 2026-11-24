#!/usr/bin/env bash
# Invariants of preview-slug.sh: DNS-safe output, bounded length, reserved names and clashes refused.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
slug() { ./preview-slug.sh "$@" </dev/null; }
fail() { echo "FAIL: $*" >&2; exit 1; }

[ "$(slug 'Feature/Login_Fix')" = feature-login-fix ] || fail 'mapping'
[ "$(slug '--a..b--')" = a-b ] || fail 'collapse and trim'
long=$(slug "$(printf 'x%.0s' $(seq 100))-end")
[ "${#long}" -le 40 ] || fail 'length'
cut=$(slug 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-b')
[[ $cut != *- ]] || fail 'truncation leaves a trailing hyphen'
for bad in '' '///' test WWW hooks; do
  if slug "$bad" 2>/dev/null; then fail "'$bad' accepted"; fi
done
for b in 'ünï/ö' 'a b' 'A.B.C' '$(id)' '../x'; do
  out=$(slug "$b" 2>/dev/null) || continue
  [[ $out =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || fail "'$b' -> '$out' not DNS-safe"
done

pulls='[{"number":7,"head":{"ref":"Feature-X","repo":{"full_name":"o/r"}},"base":{"repo":{"full_name":"o/r"}}},
        {"number":8,"head":{"ref":"feature-y","repo":{"full_name":"fork/r"}},"base":{"repo":{"full_name":"o/r"}}}]'
if ./preview-slug.sh feature-x 9 <<<"$pulls" 2>/dev/null; then fail 'clash with PR 7 accepted'; fi
[ "$(./preview-slug.sh feature-x 7 <<<"$pulls")" = feature-x ] || fail 'own slug refused'
[ "$(./preview-slug.sh feature-y 9 <<<"$pulls")" = feature-y ] || fail 'fork PR counted as clash'
echo 'OK: preview-slug'
