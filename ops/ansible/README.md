# Ansible: edge proxy and test server

Two hosts today, prod later:

- **edge** (OCI VM): Caddy with Let's Encrypt (HTTP-01, stock image) for every public test name, forwarding over WireGuard. Runs in `/opt/edge`.
- **test** (home server): WireGuard client (dials out, no port forwarding), the portal stack from `compose.yaml` + `compose.test.yaml` in `/opt/abizeitbetrug`, images from GHCR (`:main`), a deploy webhook (GitHub tells the server when the `Images` workflow succeeded on `main`), and a systemd timer that pulls new images hourly as fallback.

```
GitHub ── POST /hooks/deploy ──> edge Caddy ──> 10.77.0.2:9000 (webhook listener, see below)
browser ── https ──> edge Caddy ── WireGuard 10.77.0.1 → 10.77.0.2 ──> test Caddy (http, Caddyfile.test) ──> portal
```

## First run

1. DNS at IONOS: `test.abizeitbetrug.de` A → OCI public IP. OCI VCN security list: 80/tcp, 443/tcp+udp, 51820/udp.
2. Fill `CHANGE_ME` in `inventory.yml` and `group_vars/*/vars.yml` (hosts, WireGuard public keys, endpoint, sender address).
3. Secrets: `ansible-vault create group_vars/edge/vault.yml` and `group_vars/test/vault.yml` with the keys from `vault.example.yml`. Keep the vault password in a password manager.
4. GHCR: after the first `Images` workflow run, set the three `abizeitung-*` packages to public (they contain no secrets), or the test server cannot pull.
5. `gh auth login` on the controller (needs admin rights on `lgoeldner/abz-azb-portal`): the playbook creates the repo webhook (see below).
6. `ansible-playbook playbook.yml --ask-vault-pass`

`manage_ufw` is off: check the host's existing iptables rules (OCI images ship their own) before turning it on per host.

## Deploy webhook

Flow: `Images` workflow finishes on GitHub, GitHub POSTs a signed `workflow_run` event to `https://test.abizeitbetrug.de/hooks/deploy`, the edge routes `/hooks/*` (`hooks_upstream` in `edge_sites`) over WireGuard to `10.77.0.2:9000`, [adnanh/webhook](https://github.com/adnanh/webhook) (Ubuntu package `webhook`, unit overridden to run as the system user `webhook`, hooks file `/etc/webhook/hooks.json`, mode 0640 root:webhook) checks the delivery and starts `abizeitbetrug-test-update.service` (`docker compose pull` + `up -d`). The listener binds only the WireGuard address.

The hook `deploy` fires only if all hold: valid HMAC-SHA256 of the body (`X-Hub-Signature-256`), `X-GitHub-Event: workflow_run`, `action: completed`, workflow `Images`, branch `main`, conclusion `success`, repository `lgoeldner/abz-azb-portal`. Nothing from the payload reaches the command. A sudoers drop-in allows user `webhook` exactly `systemctl start --no-block abizeitbetrug-test-update.service`. Other deliveries (including GitHub's `ping`) are answered 200 and ignored.

Secret: `vault_test_webhook_secret` in `group_vars/test/vault.yml` (`openssl rand -hex 32`), used as `test_webhook_secret`. Never put it on a command line.

The playbook creates the GitHub webhook itself, from the controller, with the authenticated `gh` CLI (`test_webhook_manage: true`, default): it lists the repo's hooks and, if none has `config.url == https://<test_host>/hooks/deploy`, POSTs one (event `workflow_run`, JSON, the vault secret passed on stdin, tasks run with `no_log`). An existing webhook is left alone: GitHub never returns the secret, so the run stays idempotent. Set `test_webhook_manage: false` to skip all GitHub calls.

Rotate the secret: change `vault_test_webhook_secret`, then `ansible-playbook playbook.yml --ask-vault-pass -e test_webhook_rotate=true`. This writes the new secret to the hooks file and PATCHes the existing GitHub webhook's config. Run without the flag afterwards.

Deliveries made while the test server is offline are lost (GitHub does not retry automatically); the hourly timer catches up. Redeliver manually under repo Settings > Webhooks > Recent Deliveries. With `manage_ufw`, the playbook also allows the edge to reach port 9000 on `wg0`.

## Local check

`./test-orb.sh` creates two fresh OrbStack machines, runs the playbook twice (second run must change nothing), and checks the tunnel, `/readyz` through the edge, `/internal` returning 404, and that the auth service records the real client IP instead of the edge's tunnel address. It also sends signed `workflow_run` deliveries through the edge: a valid one must start the update service; a wrong signature, another branch, a failed run and another event type must not; the listener must only be bound to the WireGuard address. It sets `test_webhook_manage: false` and never talks to GitHub. Images are built locally; edge TLS uses Caddy's internal CA.
