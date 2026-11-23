# Ansible: edge proxy and test server

Two hosts today, prod later:

- **edge** (OCI VM): Caddy with Let's Encrypt (HTTP-01, stock image) for every public test name, forwarding over WireGuard. Runs in `/opt/edge`.
- **test** (home server): WireGuard client (dials out, no port forwarding), the portal stack from `compose.yaml` + `compose.test.yaml` in `/opt/abizeitbetrug`, images from GHCR (`:main`), a systemd timer that pulls new images every 5 minutes.

```
browser ── https ──> edge Caddy ── WireGuard 10.77.0.1 → 10.77.0.2 ──> test Caddy (http, Caddyfile.test) ──> portal
```

## First run

1. DNS at IONOS: `test.abizeitbetrug.de` A → OCI public IP. OCI VCN security list: 80/tcp, 443/tcp+udp, 51820/udp.
2. Fill `CHANGE_ME` in `inventory.yml` and `group_vars/*/vars.yml` (hosts, WireGuard public keys, endpoint, sender address).
3. Secrets: `ansible-vault create group_vars/edge/vault.yml` and `group_vars/test/vault.yml` with the keys from `vault.example.yml`. Keep the vault password in a password manager.
4. GHCR: after the first `Images` workflow run, set the three `abizeitung-*` packages to public (they contain no secrets), or the test server cannot pull.
5. `ansible-playbook playbook.yml --ask-vault-pass`

`manage_ufw` is off: check the host's existing iptables rules (OCI images ship their own) before turning it on per host.

## Local check

`./test-orb.sh` creates two fresh OrbStack machines, runs the playbook twice (second run must change nothing), and checks the tunnel, `/readyz` through the edge, `/internal` returning 404, and that the auth service records the real client IP instead of the edge's tunnel address. Images are built locally; edge TLS uses Caddy's internal CA.
