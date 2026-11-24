# Ansible: edge proxy and test server

Two hosts today, prod later:

- **edge** (OCI VM): Caddy with Let's Encrypt (HTTP-01, stock image) for every public test name, forwarding into the reverse SSH tunnel. Runs in `/opt/edge`. User `deploy` there is a jump host only (no shell, forwards only to the tunnel's ssh port).
- **test** (home server, Fedora): `abizeitbetrug-tunnel.service` (user `deploy`) dials `deploy@edge` and opens reverse forwards on the edge's loopback: `2222` → its sshd, `8081` → test Caddy, `9000` → webhook listener. No port forwarding at home, nothing listens on outside addresses. Also: the portal stack from `compose.yaml` + `compose.test.yaml` in `/opt/abizeitbetrug`, images from GHCR (`:dev`), a deploy webhook (GitHub tells the server when the `Images` workflow succeeded on `dev`), a systemd timer that pulls new images hourly as fallback, and PR previews (below).

```
GitHub ── POST /hooks/deploy ──> edge Caddy ──> 127.0.0.1:9000 ══ tunnel ══> 127.0.0.1:9000 webhook listener
browser ── https ──> edge Caddy ──> 127.0.0.1:8081 ══ tunnel ══> 127.0.0.1:80 test Caddy (http, Caddyfile.test) ──> portal
ssh ── ProxyJump deploy@edge ──> 127.0.0.1:2222 ══ tunnel ══> sshd (Ansible, CI: user deploy)
```

## First run

1. DNS at IONOS: `test.abizeitbetrug.de` A → OCI public IP. OCI VCN security list: 80/tcp, 443/tcp+udp. The OCI image firewall rejects everything but 22: add `-A INPUT -p tcp -m state --state NEW -m multiport --dports 80,443 -j ACCEPT` live once on a fresh VM (the playbook only persists it in `/etc/iptables/rules.v4`).
2. Home server: user `deploy` with your key in `authorized_keys` and `/etc/sudoers.d/deploy` (`deploy ALL=(ALL) NOPASSWD: ALL`), Docker and sshd installed. The playbook keeps the sudoers file afterwards.
3. Secrets: `ansible-vault create group_vars/test/vault.yml` with the keys from `vault.example.yml`. The vault password is read from `.vault-pass` in the repo root (gitignored, `ansible.cfg`); keep a copy in a password manager.
4. GHCR: after the first `Images` workflow run, set the three `abizeitung-*` packages to public (they contain no secrets), or the test server cannot pull. The same for `abizeitung-portal-preview` and `abizeitung-auth-preview` after the first `Preview` run (the sync logs a warning while a manifest is missing).
5. `gh auth login` on the controller (needs admin rights on `lgoeldner/abz-azb-portal`): the playbook creates the repo webhook (see below).
6. First run, from the home LAN (the tunnel does not exist yet): `ansible-playbook playbook.yml -e home_lan=true`. Later runs go through the edge: `ansible-playbook playbook.yml`.

Interactive ssh from anywhere: `ssh -J deploy@<edge> -p 2222 deploy@127.0.0.1` (add `-o HostKeyAlias=<home host>` to reuse its known_hosts entry).

`manage_ufw` is off: check the host's existing iptables rules (OCI images ship their own) before turning it on per host.

## Preview deployments

Every same-repo, non-draft, non-bot pull request gets a throwaway copy at `<branch-slug>.test.abizeitbetrug.de`, also when it has merge conflicts with `dev` (the workflow is `pull_request_target`, which runs regardless; the preview is the branch as pushed, not merged). Fresh database on every push, all fixture kinds (`SEED_PREVIEW`), mock login (users from `deployables/auth-mock/users.yaml`), no mail, no egress. At most 3 are live; the oldest deploy is evicted by a newer one, and a preview disappears 3 days after its last push or when the PR closes. A PR that found no slot waits and takes the next free one. An expired or evicted preview comes back with a new push or by re-running the `Preview` workflow of the PR. Forks never get one. The PR shows a "View deployment" button (environment `preview/pr-<n>`); it goes inactive when the PR closes and, via the daily `Preview cleanup` workflow, 3 days after the push. That workflow also deletes preview image versions older than 4 days from GHCR (it runs from `main` only; it needs `packages: write` for the repository's packages, else use a PAT secret). A name without a running preview shows a "No preview here" page. `<branch>-test.domain` is impossible (the DNS wildcard is a whole label), hence `<slug>.test`. Branch names land in certificate-transparency logs (public repo, accepted).

```
PR push ──> Preview workflow builds abizeitung-{portal,auth}-preview:<sha> ──> workflow_run webhook /hooks/preview ──> preview-sync.service (also every 10 min)
browser ── https, basic_auth ──> edge Caddy *.test.abizeitbetrug.de (certificate on demand, asks 127.0.0.1:8084/ask) ──> 127.0.0.1:8083 ══ preview tunnel ══> 127.0.0.1:18083 preview Caddy ──> pv-<n>:8080
```

- **Sync** (`roles/test_host/files/preview-sync.sh`, `/opt/abizeitbetrug-preview`): reads GitHub's open pull list (ETag, optional `test_preview_gh_token`), deploys the head sha when it differs from the running one (`docker compose -p pv-<n>`, container labels hold PR, sha and host), tears down closed, ineligible, expired and evicted previews, keeps `parked/<n>` (`<sha> <epoch>`) so an expired or evicted sha does not come back until a new push or a successful re-run of the Preview workflow finished after it was parked (the run name `Preview #<pr> <sha>` identifies it; one extra API call, only while a marker exists), keeps `waiting/<n>` for PRs that never got a slot, rewrites the preview Caddyfile and reloads it. Any API or parse failure changes nothing and exits non-zero (`journalctl -u abizeitbetrug-preview-sync`). Run it by hand: `sudo systemctl start abizeitbetrug-preview-sync`. A trigger while it runs is dropped; the timer catches up.
- **Isolation**: each preview has an `internal: true` project network and joins the shared `preview` network created with `--internal` (no gateway). Database and uploads are size-capped tmpfs; memory, CPU and pids are limited; `cap_drop: ALL`. Previews can reach each other through the shared network (fake data, accepted). The preview Caddy holds no test secrets and sends no `X-Portal-Proxy-Token`; `/internal` is 404. `/ask` is on a second, separate listener (`18084`) that answers 200 only for live hosts and the names of eligible open PRs (so their link gets a certificate and the "No preview here" page, not a TLS error).
- **Second tunnel** (`abizeitbetrug-preview-tunnel.service`, own key `preview_tunnel_ed25519`, `permitlisten` only `8083` and `8084`): a preview forward that fails cannot drop the test site, hooks or ssh. Check that `tunnel_preview_http_port`/`tunnel_preview_ask_port` are free on the OCI VM.
- **Two GitHub webhooks**: besides `/hooks/deploy` the playbook creates `/hooks/preview` (same secret), which fires on a successful `Preview` `workflow_run` and starts `abizeitbetrug-preview-sync.service` (own sudoers line).
- **DNS**: `*.test.abizeitbetrug.de` A → OCI IP. Let's Encrypt allows 50 certificates per week for the registrable domain; only live previews and open PRs' names get one.
- **Cookies**: test and prod use `__Host-` cookies (`APP_ENV=production`) and Go checks Origin and the CSRF token, so previews (unprefixed cookies) cannot shadow or forge them.

Risk to keep in mind: a preview is an admin-everything fake instance. Reachable by anyone it is a phishing and abuse surface under the production domain, so the edge `basic_auth` is mandatory: the playbook fails before touching Caddy unless `edge_preview_basic_auth_hash` is a bcrypt hash (`$2a$`/`$2y$`). The `Authorization` header is dropped before the request reaches a preview.

### Rotate the preview password

On demand, no schedule. The plaintext is never stored.

1. `docker run --rm caddy:2.10-alpine caddy hash-password` (prompts for the new password).
2. `ansible-vault edit group_vars/edge/vault.yml`, set `vault_edge_preview_basic_auth_hash` to the hash (single-quote it: it contains `$`).
3. `ansible-playbook playbook.yml --limit edge`: renders the Caddyfile and reloads Caddy gracefully, open connections survive.
4. Hand the new password to contributors out of band.

First setup is the same steps with a new key. One user line per contributor (per-person revocation) is possible later; not built.

## OS updates

Both hosts install OS updates weekly, Tuesday 04:30 Europe/Berlin (`auto_update_calendar` in `group_vars/all.yml`; role `common`, `tasks/auto_update.yml`). Ubuntu edge: unattended-upgrades (security and `-updates`; the package list refresh runs at 04:25). Fedora home server: `dnf5-automatic`. Neither reboots: kernel updates apply after the next manual reboot, which briefly takes the tunnel and stack down.

## Deploy webhook

Flow: `Images` workflow finishes on GitHub, GitHub POSTs a signed `workflow_run` event to `https://test.abizeitbetrug.de/hooks/deploy`, the edge routes `/hooks/*` (`hooks_upstream` in `edge_sites`) to `127.0.0.1:9000`, through the tunnel to the home server's `127.0.0.1:9000`, [adnanh/webhook](https://github.com/adnanh/webhook) (release 2.8.3 pinned by sha256 in `roles/test_host/vars/main.yml`, unit `abizeitbetrug-webhook.service` as the system user `webhook`, hooks file `/etc/webhook/hooks.json`, mode 0640 root:webhook) checks the delivery and starts `abizeitbetrug-test-update.service` (`docker compose pull` + `up -d`). The listener binds only loopback.

The hook `deploy` fires only if all hold: valid HMAC-SHA256 of the body (`X-Hub-Signature-256`), `X-GitHub-Event: workflow_run`, `action: completed`, workflow `Images`, branch `dev`, conclusion `success`, repository `lgoeldner/abz-azb-portal`. Nothing from the payload reaches the command. A sudoers drop-in allows user `webhook` exactly `systemctl start --no-block abizeitbetrug-test-update.service`. Other deliveries (including GitHub's `ping`) are answered 200 and ignored.

Secret: `vault_test_webhook_secret` in `group_vars/test/vault.yml` (`openssl rand -hex 32`), used as `test_webhook_secret`. Never put it on a command line.

The playbook creates the GitHub webhook itself, from the controller, with the authenticated `gh` CLI (`test_webhook_manage: true`, default): it lists the repo's hooks and, if none has `config.url == https://<test_host>/hooks/deploy`, POSTs one (event `workflow_run`, JSON, the vault secret passed on stdin, tasks run with `no_log`). An existing webhook is left alone: GitHub never returns the secret, so the run stays idempotent. Set `test_webhook_manage: false` to skip all GitHub calls.

Rotate the secret: change `vault_test_webhook_secret`, then `ansible-playbook playbook.yml --ask-vault-pass -e test_webhook_rotate=true`. This writes the new secret to the hooks file and PATCHes the existing GitHub webhook's config. Run without the flag afterwards.

Deliveries made while the test server is offline are lost (GitHub does not retry automatically); the hourly timer catches up. Redeliver manually under repo Settings > Webhooks > Recent Deliveries.

## Local check

`./test-orb.sh` creates two fresh OrbStack machines (Ubuntu edge, Fedora home), runs the playbook twice (second run must change nothing), and checks the tunnel listeners and the sshd behind the jump port, `/readyz` through the edge, `/internal` returning 404, and that the auth service records the real client IP instead of a proxy address. It also sends signed `workflow_run` deliveries through the edge: a valid one must start the update service; a wrong signature, another branch, a failed run and another event type must not; the listener must only be bound to loopback. It also runs the preview sync against a fake pull list (`file://`): deploy, new commit with a fresh database, eviction beyond three, draft/bot/fork PRs ignored, expiry and parking, closed PRs, an unreadable or malformed list changing nothing, preview Caddy routing and `/ask`, no route out of a preview container (bridge gateway, test egress subnet, LAN, internet), edge `401` without and `200` with the password, the preview webhook, and password rotation (old password `401`, new `200`; an empty or malformed hash fails the playbook before any change). It sets `test_webhook_manage: false` and never talks to GitHub. Images are built locally; edge TLS uses Caddy's internal CA.
