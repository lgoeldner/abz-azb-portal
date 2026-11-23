#!/usr/bin/env bash
# End-to-end check of the Ansible roles on two disposable OrbStack machines:
# edge (Caddy + WireGuard server) and test host (WireGuard client + stack).
# Asserts: the tunnel works, the edge serves the test stack, /internal stays closed,
# and the auth service sees the real client IP instead of the edge's tunnel address.
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

# A rate-limited auth request from the edge itself: its key must carry the client's address (127.0.0.1), not 10.77.0.1.
curl_edge -o /dev/null -X POST -H 'content-type: application/json' -H "origin: https://$host" \
  -d '{"email":"nobody@example.org"}' "https://$host/api/auth/sign-in/magic-link" || true
keys=$(orb -m abz-home bash -c "cd /opt/abizeitbetrug && sudo docker compose exec -T db psql -U portal -d portal -Atc 'SELECT key FROM auth_rate_limits'")
echo "rate-limit keys: $keys"
grep -q '127\.0\.0\.1' <<<"$keys" || { echo 'FAIL: auth does not see the client IP' >&2; exit 1; }

echo 'OK: edge, tunnel, test stack, /internal and client IP'
