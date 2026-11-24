#!/usr/bin/env bash
# End-to-end check of the Ansible roles on two disposable OrbStack machines:
# edge (Ubuntu, Caddy, jump host) and test host (Fedora like the real one, reverse SSH tunnel + stack).
# Asserts: the tunnel listeners exist on the edge's loopback (sshd banner on the jump port), the edge serves the test stack, /internal stays closed,
# the auth service sees the real client IP instead of a proxy address, and the deploy
# webhook (signed GitHub workflow_run through the edge) starts the update service only for valid deliveries.
# PR previews: sync script against a fake GitHub pull list (deploy, fresh database per sha, eviction, expiry, closed PRs,
# API failure), preview Caddy routing and ask, no egress from a preview, edge basic_auth with password rotation, the preview webhook.
# Every run recreates both machines. Remove them afterwards with: orb delete -f abz-edge abz-home
set -euo pipefail
cd "$(dirname "$0")"
repo=$(git rev-parse --show-toplevel)
host=test.abizeitbetrug.de

# Fresh machines every run: secrets are regenerated, an old database volume would not match them.
orb delete -f abz-edge abz-home 2>/dev/null || true
orb create ubuntu:noble abz-edge
orb create fedora abz-home
# The real home server brings Docker and sshd itself; the roles do not install them on Fedora.
orb -m abz-home sudo dnf -yq install moby-engine docker-compose openssh-server python3
orb -m abz-home sudo systemctl enable --now docker sshd

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
edge_ip=$(orb -m abz-edge hostname -I | tr ' ' '\n' | grep -m1 -E '^[0-9]+\.')
preview_password=$(openssl rand -hex 8)
preview_hash=$(docker run --rm caddy:2.10-alpine caddy hash-password --plaintext "$preview_password")
echo '[]' | orb -m abz-home sudo tee /tmp/preview-pulls.json >/dev/null
secret() { openssl rand -hex 32; }
webhook_secret=$(secret)
cat >"$tmp/vars.yml" <<EOF
tunnel_edge_host: $edge_ip
edge_tls_internal: true
test_image_prefix: ""
test_app_version: local
test_pull_images: false
test_auto_update: false
test_webhook_manage: false
test_preview_pulls_url: file:///tmp/preview-pulls.json
edge_preview_basic_auth_hash: '$preview_hash'
vault_test_webhook_secret: $webhook_secret
vault_test_mail_from: "AbiZeitBetrug Test <test@example.org>"
vault_test_postgres_password: $(secret)
vault_test_auth_service_secret: $(secret)
vault_test_better_auth_secret: $(secret)
vault_test_session_secret: $(secret)
vault_test_brevo_api_key: disposable-not-a-real-key
vault_test_restic_password: $(secret)
EOF

run() { ansible-playbook -i inventory.orb.yml -e "@$tmp/vars.yml" playbook.yml "$@"; }

run --skip-tags stack
# Images are built here for the machines' architecture instead of pulled from GHCR.
docker build -q -t abizeitung-portal:local "$repo/deployables/portal"
docker build -q -t abizeitung-auth:local --target production "$repo/deployables/auth"
docker build -q -t abizeitung-portal-backup:local "$repo/deployables/backup"
docker build -q -t abizeitung-auth-mock:local --target development-mock "$repo/deployables/auth"
for image in abizeitung-portal abizeitung-auth abizeitung-portal-backup abizeitung-auth-mock; do
  docker save "$image:local" | orb -m abz-home sudo docker load
done
run
run | tee "$tmp/second-run.log" # idempotence
if grep -qE 'changed=[1-9]' "$tmp/second-run.log"; then echo 'FAIL: second run changed something' >&2; exit 1; fi

edge() { orb -m abz-edge "$@"; }
curl_edge() { edge curl -sk --resolve "$host:443:127.0.0.1" "$@"; }

for _ in $(seq 20); do edge ss -Hltn 'sport = :8081' | grep -q 127.0.0.1 && break; sleep 1; done
for port in 2222 8081 9000; do
  [ "$(edge ss -Hltn "sport = :$port" | awk '{print $4}')" = "127.0.0.1:$port" ] || { echo "FAIL: tunnel listener $port" >&2; exit 1; }
done
edge bash -c 'exec 3<>/dev/tcp/127.0.0.1/2222 && head -c 7 <&3' | grep -q '^SSH-2.0' || { echo 'FAIL: no sshd behind the jump port' >&2; exit 1; }
[ "$(curl_edge -o /dev/null -w '%{http_code}' "https://$host/readyz")" = 200 ] || { echo 'FAIL: readyz through edge' >&2; exit 1; }
[ "$(curl_edge -o /dev/null -w '%{http_code}' "https://$host/internal/x")" = 404 ] || { echo 'FAIL: /internal reachable' >&2; exit 1; }
curl_edge "https://$host/" | grep -q 'data-env="test"' || { echo 'FAIL: test marker missing' >&2; exit 1; }

# A rate-limited auth request from the edge itself: its key must carry the client's address (127.0.0.1), not the egress gateway.
curl_edge -o /dev/null -X POST -H 'content-type: application/json' -H "origin: https://$host" \
  -d '{"email":"nobody@example.org"}' "https://$host/api/auth/sign-in/magic-link" || true
keys=$(orb -m abz-home bash -c "cd /opt/abizeitbetrug && sudo docker compose exec -T db psql -U portal -d portal -Atc 'SELECT key FROM auth_rate_limits'")
echo "rate-limit keys: $keys"
grep -q '127\.0\.0\.1' <<<"$keys" || { echo 'FAIL: auth does not see the client IP' >&2; exit 1; }

# Deploy webhook. The update unit may fail here (images are local); only "was it started" is asserted.
home() { orb -m abz-home "$@"; }
unit=abizeitbetrug-test-update.service
invocation() { home systemctl show -p InvocationID --value "$unit"; }
settle() { for _ in $(seq 30); do case $(home systemctl is-active "$unit" || true) in activating | active | deactivating) sleep 1 ;; *) return 0 ;; esac; done; }
sign() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$2" | sed 's/^.* //'; }
payload() { # branch conclusion
  printf '{"action":"completed","workflow_run":{"name":"Images","head_branch":"%s","conclusion":"%s"},"repository":{"full_name":"lgoeldner/abz-azb-portal"}}' "$1" "$2"
}
deliver() { # body signature event -> http code
  curl_edge -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H "X-GitHub-Event: $3" \
    -H "X-Hub-Signature-256: sha256=$2" -d "$1" "https://$host/hooks/deploy"
}
# Asserts the delivery did (want=started) or did not (want=idle) start the unit.
expect_deploy() { # label want body signature [event]
  local before after code
  settle
  before=$(invocation)
  code=$(deliver "$3" "$4" "${5:-workflow_run}")
  sleep 4
  after=$(invocation)
  if [ "$2" = started ]; then
    case $code in 2??) ;; *) echo "FAIL: webhook '$1' answered $code" >&2; exit 1 ;; esac
    [ "$before" != "$after" ] || { echo "FAIL: webhook '$1' did not start $unit" >&2; exit 1; }
  else
    [ "$before" = "$after" ] || { echo "FAIL: webhook '$1' started $unit" >&2; exit 1; }
  fi
}
good=$(payload dev success)
expect_deploy 'valid delivery' started "$good" "$(sign "$good" "$webhook_secret")"
expect_deploy 'wrong signature' idle "$good" "$(sign "$good" wrong-secret)"
bad=$(payload main success)
expect_deploy 'other branch' idle "$bad" "$(sign "$bad" "$webhook_secret")"
bad=$(payload dev failure)
expect_deploy 'failed run' idle "$bad" "$(sign "$bad" "$webhook_secret")"
expect_deploy 'other event' idle "$good" "$(sign "$good" "$webhook_secret")" ping

# The listener is bound to loopback only; the tunnel is its only way in.
listeners=$(home ss -Hltn 'sport = :9000' | awk '{print $4}')
[ "$listeners" = 127.0.0.1:9000 ] || { echo "FAIL: webhook listens on: $listeners" >&2; exit 1; }
home_lan=$(home hostname -I | tr ' ' '\n' | grep -m1 -E '^[0-9]+\.')
if edge curl -s -o /dev/null --max-time 5 "http://$home_lan:9000/hooks/deploy"; then echo 'FAIL: webhook reachable on the LAN address' >&2; exit 1; fi
if edge curl -s -o /dev/null --max-time 5 "http://$home_lan:80/"; then echo 'FAIL: test Caddy reachable on the LAN address' >&2; exit 1; fi


# ---- PR previews ----
repo_full=lgoeldner/abz-azb-portal
sha() { printf "$1%.0s" $(seq 40); } # one hex digit repeated 40 times
sync_env=(PREVIEW_DIR=/opt/abizeitbetrug-preview "PREVIEW_REPO=$repo_full" "PREVIEW_DOMAIN=$host" PREVIEW_IMAGE_PREFIX= PREVIEW_PULLS_URL=file:///tmp/preview-pulls.json PREVIEW_HTTP_PORT=18083 PREVIEW_ASK_PORT=18084)
# The sync removes preview images nobody runs, so the stand-ins for GHCR are tagged again before every run.
sync() { for d in a b c d e; do tag_images "$d"; done; home sudo env "${sync_env[@]}" "$@" bash /opt/abizeitbetrug-preview/preview-sync.sh; }
pull() { # number branch sha-digit updated_at
  jq -n --argjson n "$1" --arg ref "$2" --arg sha "$(sha "$3")" --arg upd "$4" --arg repo "$repo_full" \
    '{number:$n,state:"open",draft:false,user:{type:"User"},updated_at:$upd,head:{ref:$ref,sha:$sha,repo:{full_name:$repo}},base:{repo:{full_name:$repo}}}'
}
set_pulls() { jq -s . | home sudo tee /tmp/preview-pulls.json >/dev/null; }
live() { home sudo docker ps -a --filter label=azb.preview.pr --format '{{.Label "azb.preview.pr"}}' | sort -n | tr '\n' ' '; }
container_id() { home sudo docker ps -aq --filter "label=azb.preview.pr=$1"; }
expect_live() { [ "$(live)" = "$1" ] || { echo "FAIL: live previews '$(live)', want '$1'" >&2; exit 1; }; }
tag_images() { # sha digit: the sync pulls <name>-preview:<sha>; the local images stand in for GHCR
  home sudo docker tag abizeitung-portal:local "abizeitung-portal-preview:$(sha "$1")"
  home sudo docker tag abizeitung-auth-mock:local "abizeitung-auth-preview:$(sha "$1")"
}
phost() { echo "$1.$host"; }
via_preview_caddy() { home curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "http://127.0.0.1:18083${2:-/readyz}"; }
ask() { home curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:18084/ask?domain=$1"; }

# One PR: deploys, routes, certificate ask only for live hosts.
{ pull 1 Feature/One a 2026-11-20T10:00:00Z; } | set_pulls
sync
expect_live '1 '
[ "$(via_preview_caddy "$(phost feature-one)")" = 200 ] || { echo 'FAIL: preview not served' >&2; exit 1; }
[ "$(via_preview_caddy "$(phost feature-one)" /internal/x)" = 404 ] || { echo 'FAIL: preview /internal reachable' >&2; exit 1; }
[ "$(via_preview_caddy "$(phost nope)")" = 404 ] || { echo 'FAIL: unknown preview host served' >&2; exit 1; }
[ "$(ask "$(phost feature-one)")" = 200 ] || { echo 'FAIL: ask refuses a live host' >&2; exit 1; }
[ "$(ask "$(phost nope)")" = 404 ] || { echo 'FAIL: ask accepts an unknown host' >&2; exit 1; }
[ "$(ask "$host")" = 404 ] || { echo 'FAIL: ask accepts the test host' >&2; exit 1; }
# The public listener has no /ask: a name that is not a live preview gets 404 whatever the query says.
[ "$(home curl -s -o /dev/null -w '%{http_code}' -H "Host: $(phost nope)" "http://127.0.0.1:18083/ask?domain=$(phost feature-one)")" = 404 ] || { echo 'FAIL: /ask reachable through the public listener' >&2; exit 1; }
if home sudo grep -qi 'X-Portal-Proxy-Token' /opt/abizeitbetrug-preview/caddy/Caddyfile; then echo 'FAIL: preview Caddy sends the proxy token' >&2; exit 1; fi
home curl -s -H "Host: $(phost feature-one)" http://127.0.0.1:18083/ | grep -q 'data-env="preview"' || { echo 'FAIL: preview marker missing' >&2; exit 1; }

# Edge: basic_auth in front, certificate on demand through the second tunnel.
pcurl() { curl_edge --resolve "$(phost feature-one):443:127.0.0.1" "$@"; }
for _ in $(seq 20); do edge ss -Hltn 'sport = :8083' | grep -q 127.0.0.1 && break; sleep 1; done
[ "$(pcurl -o /dev/null -w '%{http_code}' "https://$(phost feature-one)/readyz")" = 401 ] || { echo 'FAIL: preview without credentials' >&2; exit 1; }
[ "$(pcurl -u "preview:$preview_password" -o /dev/null -w '%{http_code}' "https://$(phost feature-one)/readyz")" = 200 ] || { echo 'FAIL: preview with credentials' >&2; exit 1; }
[ "$(curl_edge --resolve "$(phost nope):443:127.0.0.1" -u "preview:$preview_password" -o /dev/null -w '%{http_code}' "https://$(phost nope)/readyz" || true)" != 200 ] || { echo 'FAIL: unknown preview name got a response' >&2; exit 1; }

# A preview has no way out: bridge gateway, the test stack's egress subnet, the LAN and the internet all fail.
gw=$(home sudo docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
home_lan=$(home hostname -I | tr ' ' '\n' | grep -m1 -E '^[0-9]+\.')
for target in "$gw:22" "$gw:80" "$gw:9000" 172.30.77.1:80 172.30.77.1:22 "$home_lan:22" "$home_lan:80" "$home_lan:9000" 1.1.1.1:443; do
  if home sudo docker exec "$(container_id 1)" wget -q -T 3 -O /dev/null "http://$target"; then echo "FAIL: preview container reached $target" >&2; exit 1; fi
done

# A new commit recreates the preview with a fresh database.
home sudo docker exec "$(home sudo docker ps -q --filter label=com.docker.compose.project=pv-1 --filter label=com.docker.compose.service=db)" psql -U portal -d portal -c 'CREATE TABLE marker(x int)' >/dev/null
old=$(container_id 1)
{ pull 1 Feature/One b 2026-11-20T11:00:00Z; } | set_pulls
sync
[ "$(container_id 1)" != "$old" ] || { echo 'FAIL: new commit did not recreate the preview' >&2; exit 1; }
[ "$(home sudo docker exec "$(home sudo docker ps -q --filter label=com.docker.compose.project=pv-1 --filter label=com.docker.compose.service=db)" psql -U portal -d portal -Atc "SELECT to_regclass('marker') IS NULL")" = t ] || { echo 'FAIL: database survived the redeploy' >&2; exit 1; }
sync
[ "$(container_id 1)" != "" ] && [ "$(live)" = '1 ' ] || { echo 'FAIL: unchanged sync disturbed the preview' >&2; exit 1; }

# A failing GitHub API changes nothing.
before=$(container_id 1)
if sync PREVIEW_PULLS_URL=file:///nonexistent; then echo 'FAIL: sync passed with an unreadable pull list' >&2; exit 1; fi
echo '{"not":"an array"}' | home sudo tee /tmp/preview-garbage.json >/dev/null
if sync PREVIEW_PULLS_URL=file:///tmp/preview-garbage.json; then echo 'FAIL: sync accepted a malformed pull list' >&2; exit 1; fi
[ "$(container_id 1)" = "$before" ] || { echo 'FAIL: API failure changed the preview' >&2; exit 1; }

# More PRs than slots: the oldest deploy is evicted, stays down until it gets a new commit.
{ pull 1 Feature/One b 2026-11-20T11:00:00Z; pull 2 two c 2026-11-21T10:00:00Z; pull 3 three c 2026-11-21T11:00:00Z; pull 4 four d 2026-11-22T10:00:00Z; } | set_pulls
sync
expect_live '2 3 4 '
sync
expect_live '2 3 4 '
# Draft, bot and fork PRs never get a preview; a closed one is removed.
{ pull 2 two c 2026-11-21T10:00:00Z; pull 3 three c 2026-11-21T11:00:00Z
  pull 5 drafty e 2026-11-23T10:00:00Z | jq '.draft=true'
  pull 6 botty e 2026-11-23T10:00:00Z | jq '.user.type="Bot"'
  pull 7 forky e 2026-11-23T10:00:00Z | jq '.head.repo.full_name="someone/fork"'
  pull 8 'x/../y' e 2026-11-23T10:00:00Z | jq '.head.ref="test"'; } | set_pulls
sync
expect_live '2 3 '
# Expiry: 3 days after the last deploy it is torn down and stays down for the same commit.
sync PREVIEW_NOW=$(( $(date +%s) + 4 * 86400 ))
expect_live ''
sync
expect_live ''
# A new commit brings it back.
{ pull 2 two d 2026-11-26T10:00:00Z; } | set_pulls
sync
expect_live '2 '
echo '[]' | home sudo tee /tmp/preview-pulls.json >/dev/null
sync
expect_live ''
if home sudo docker network inspect preview -f '{{len .Containers}}' | grep -qv '^1$'; then echo 'FAIL: containers left on the preview network (only the preview Caddy may remain)' >&2; exit 1; fi

# Image cleanup also matches registry-prefixed names (the real prefix is ghcr.io/<owner>/).
home sudo docker tag abizeitung-portal:local "ghcr.io/example/abizeitung-portal-preview:$(sha e)"
sync
[ -z "$(home sudo docker images -q ghcr.io/example/abizeitung-portal-preview)" ] || { echo 'FAIL: image cleanup misses registry-prefixed preview images' >&2; exit 1; }

# Preview webhook: signed Preview workflow_run starts the sync unit, an Images run or a wrong signature does not.
sync_unit=abizeitbetrug-preview-sync.service
sync_invocation() { home systemctl show -p InvocationID --value "$sync_unit"; }
deliver_preview() { # body signature
  curl_edge -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'X-GitHub-Event: workflow_run' \
    -H "X-Hub-Signature-256: sha256=$2" -d "$1" "https://$host/hooks/preview"
}
preview_payload() { printf '{"action":"completed","workflow_run":{"name":"%s","head_branch":"x","conclusion":"success"},"repository":{"full_name":"%s"}}' "$1" "$repo_full"; }
for case in good wrong-secret images; do
  body=$(preview_payload Preview); secret_used=$webhook_secret
  [ "$case" = wrong-secret ] && secret_used=wrong
  [ "$case" = images ] && body=$(preview_payload Images)
  before=$(sync_invocation)
  deliver_preview "$body" "$(sign "$body" "$secret_used")" >/dev/null
  sleep 4
  after=$(sync_invocation)
  if [ "$case" = good ]; then [ "$before" != "$after" ] || { echo 'FAIL: preview webhook did not start the sync' >&2; exit 1; }
  else [ "$before" = "$after" ] || { echo "FAIL: preview webhook '$case' started the sync" >&2; exit 1; }; fi
done

# Password rotation: a new hash replaces the old password after one playbook run; an empty hash stops before any change.
new_password=$(openssl rand -hex 8)
new_hash=$(docker run --rm caddy:2.10-alpine caddy hash-password --plaintext "$new_password")
{ pull 1 Feature/One b 2026-11-26T11:00:00Z; } | set_pulls
sync
run -e "edge_preview_basic_auth_hash='$new_hash'" >/dev/null
[ "$(pcurl -u "preview:$preview_password" -o /dev/null -w '%{http_code}' "https://$(phost feature-one)/readyz")" = 401 ] || { echo 'FAIL: old password still accepted' >&2; exit 1; }
[ "$(pcurl -u "preview:$new_password" -o /dev/null -w '%{http_code}' "https://$(phost feature-one)/readyz")" = 200 ] || { echo 'FAIL: new password rejected' >&2; exit 1; }
caddyfile_before=$(edge sudo cat /opt/edge/caddy/Caddyfile)
for bad in '' 'plaintext' '$1$md5'; do
  if run -e "edge_preview_basic_auth_hash='$bad'" >/dev/null 2>&1; then echo "FAIL: playbook accepted preview hash '$bad'" >&2; exit 1; fi
done
[ "$(edge sudo cat /opt/edge/caddy/Caddyfile)" = "$caddyfile_before" ] || { echo 'FAIL: a rejected hash changed the edge Caddyfile' >&2; exit 1; }

echo 'OK: edge, tunnel, test stack, /internal, test marker, client IP, deploy webhook and PR previews'
