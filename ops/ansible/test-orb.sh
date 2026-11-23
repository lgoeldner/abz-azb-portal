#!/usr/bin/env bash
# End-to-end check of the Ansible roles on two disposable OrbStack machines:
# edge (Caddy + WireGuard server) and test host (WireGuard client + stack).
# Asserts: the tunnel works, the edge serves the test stack, /internal stays closed,
# the auth service sees the real client IP instead of the edge's tunnel address, and the deploy
# webhook (signed GitHub workflow_run through the edge) starts the update service only for valid deliveries.
# Every run recreates both machines. Remove them afterwards with: orb delete -f abz-edge abz-home
set -euo pipefail
cd "$(dirname "$0")"
repo=$(git rev-parse --show-toplevel)
host=test.abizeitbetrug.de

# Fresh machines every run: secrets are regenerated, an old database volume would not match them.
for machine in abz-edge abz-home; do
  orb delete -f "$machine" 2>/dev/null || true
  orb create ubuntu:noble "$machine"
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# IPv4 on purpose: OrbStack's machine-to-machine IPv6 drops the WireGuard packets; the real edge uses IPv4 too.
edge_ip=$(orb -m abz-edge hostname -I | tr ' ' '\n' | grep -m1 -E '^[0-9]+\.')
edge_key=$(wg genkey)
home_key=$(wg genkey)
secret() { openssl rand -hex 32; }
webhook_secret=$(secret)
cat >"$tmp/vars.yml" <<EOF
vault_wg_private_key: "{{ '$edge_key' if inventory_hostname == 'abz-edge' else '$home_key' }}"
wg_test_public_key: $(wg pubkey <<<"$home_key")
wg_edge_public_key: $(wg pubkey <<<"$edge_key")
wg_edge_endpoint: $edge_ip:51820
edge_tls_internal: true
test_image_prefix: ""
test_app_version: local
test_pull_images: false
test_auto_update: false
test_webhook_manage: false
vault_test_webhook_secret: $webhook_secret
test_mail_from: "AbiZeitBetrug Test <test@example.org>"
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
for image in abizeitung-portal abizeitung-auth abizeitung-portal-backup; do
  docker save "$image:local" | orb -m abz-home sudo docker load
done
run
run | tee "$tmp/second-run.log" # idempotence
if grep -qE 'changed=[1-9]' "$tmp/second-run.log"; then echo 'FAIL: second run changed something' >&2; exit 1; fi

edge() { orb -m abz-edge "$@"; }
curl_edge() { edge curl -sk --resolve "$host:443:127.0.0.1" "$@"; }

edge ping -c1 -W3 10.77.0.2 >/dev/null || { echo 'FAIL: tunnel down' >&2; exit 1; }
[ "$(curl_edge -o /dev/null -w '%{http_code}' "https://$host/readyz")" = 200 ] || { echo 'FAIL: readyz through edge' >&2; exit 1; }
[ "$(curl_edge -o /dev/null -w '%{http_code}' "https://$host/internal/x")" = 404 ] || { echo 'FAIL: /internal reachable' >&2; exit 1; }
curl_edge "https://$host/" | grep -q 'data-env="test"' || { echo 'FAIL: test marker missing' >&2; exit 1; }

# A rate-limited auth request from the edge itself: its key must carry the client's address (127.0.0.1), not 10.77.0.1.
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
good=$(payload main success)
expect_deploy 'valid delivery' started "$good" "$(sign "$good" "$webhook_secret")"
expect_deploy 'wrong signature' idle "$good" "$(sign "$good" wrong-secret)"
bad=$(payload feature success)
expect_deploy 'other branch' idle "$bad" "$(sign "$bad" "$webhook_secret")"
bad=$(payload main failure)
expect_deploy 'failed run' idle "$bad" "$(sign "$bad" "$webhook_secret")"
expect_deploy 'other event' idle "$good" "$(sign "$good" "$webhook_secret")" ping

# The listener is bound to the WireGuard address only.
listeners=$(home ss -Hltn 'sport = :9000' | awk '{print $4}')
[ "$listeners" = 10.77.0.2:9000 ] || { echo "FAIL: webhook listens on: $listeners" >&2; exit 1; }
home_lan=$(home hostname -I | tr ' ' '\n' | grep -m1 -E '^[0-9]+\.')
if edge curl -s -o /dev/null --max-time 5 "http://$home_lan:9000/hooks/deploy"; then echo 'FAIL: webhook reachable on the LAN address' >&2; exit 1; fi
if home curl -s -o /dev/null --max-time 5 http://127.0.0.1:9000/hooks/deploy; then echo 'FAIL: webhook reachable on loopback' >&2; exit 1; fi

echo 'OK: edge, tunnel, test stack, /internal, test marker, client IP and deploy webhook'
