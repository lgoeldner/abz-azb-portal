# Privacy and legal checklist (open items)

This is an internal compliance to-do list. It is **not** the Datenschutzerklärung and not legal advice. Do not put personal data (operator name, address, email) here; that belongs in the private runtime config once the public pages exist.

Each item lists who must act, what unblocks it, and which code change it enables afterwards.

## 1. Decisions only the operator can make

| Item | Owner | Unblocks |
| --- | --- | --- |
| **Controller (Verantwortlicher):** private student, Abi-Komitee, Förderverein or school. Decides Impressum name, who signs contracts, and the supervisory authority (BayLDA for private operators, BayLfD if the school is controller). If the operator is under 18, an adult signs contracts. | Abi-Komitee | Impressum and Datenschutz texts, consent text |
| **End and deletion date** for the portal. Nothing closes automatically in June 2027. Suggested: delete everything N months after printing. | Abi-Komitee | Retention section of the Datenschutzerklärung, deletion procedure |
| **Legal basis per purpose:** consent (Art. 6(1)(a) DSGVO) vs. participation (Art. 6(1)(b)). Recommended: consent at first login for print use of contributions and photos and for named votes. | Controller | Versioned consent step at first login (see plan) |
| **Roster source.** Self-supplied addresses are fine. A list handed over by the school needs the school's legal basis and approval (school data protection officer). | Controller + school | Roster import into production |
| **Teacher content:** quotes, rankings and photos of teachers are their personal data. Get consent, anonymise, or keep it harmless. Ask the school before showing teachers or school grounds in a sold print. | Redaktion | Optional quote approval status |

## 2. Contracts and accounts

- **AVV (Art. 28 DSGVO) with IONOS:** accept in the IONOS customer center.
- **AVV with Brevo:** part of Brevo's terms; check that it is accepted for the account.
- **Restic backup repository:** must be an EU provider with an AVV. Set in `RESTIC_REPOSITORY`.
- **Backup heartbeat monitor** (`BACKUP_HEARTBEAT_URL`): needs an AVV only if it receives personal data. A plain ping normally does not.
- **Brevo tracking off:** disable open and click tracking in the Brevo account, then set `BREVO_TRACKING_DISABLED=true` in every env file (`.env.dev` for `make dev:auth`, the production env for `compose.yaml`). Steps: [docs/auth-email-operations.md](docs/auth-email-operations.md).

## 3. Texts to write

All texts are needed before go-live and must be reachable from the login page without logging in.

- **Datenschutzerklärung (Art. 13 DSGVO):**
  - Controller and contact.
  - Data processed: account, email, submissions, photos, named votes, audit log.
  - Purposes and legal basis.
  - Who sees what: admins see named ballot history; managers read all categories.
  - Recipients: IONOS, Brevo (France), backup storage, heartbeat monitor.
  - Retention:
    - email delivery metadata: 90 days;
    - backups: up to about 12 months (restic keeps 14 daily, 8 weekly, 12 monthly snapshots), so deleted data survives in backups that long;
    - portal end date (item 1).
  - Data subject rights and the right to complain to the supervisory authority.
  - Only necessary storage is used: session cookie, plus localStorage UI preferences (`view`, `verwaltung`). No tracking. If analytics or external fonts are ever added, a consent banner becomes necessary (§ 25 TDDDG).
- **Impressum:** name, address for legal service, email. Whether § 5 DDG / § 18 MStV requires it for a closed non-commercial portal is disputed. Add it anyway because the login page is public.
- **Consent text** for first login: print use of own contributions and photos, named votes visible to admins, upload rules.
- **Upload rules / Nutzungsbedingungen:**
  - only upload your own photos;
  - people shown must agree (KUG §§ 22, 23);
  - nothing defamatory;
  - grant the rights needed for printing;
  - takedown contact.
- **Quote disclaimer** for the print (gives framing only, no legal protection):
  > Die Zitate sind aus dem Gedächtnis notiert, teils sinngemäß wiedergegeben und humoristisch gemeint. Sie geben nicht die Meinung der Zitierten oder der Redaktion wieder.

  Do not write "aus dem Zusammenhang gerissen"; it admits distortion. Get approval for anything outrageous, anonymise embarrassing quotes, and leave out sensitive topics (health, sexuality, religion, politics) and factual accusations.

## 4. Internal documents (no code)

- **Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO):** one page.
- **TOM (Art. 32 DSGVO):** half a page. Existing measures:
  - TLS via Caddy;
  - encrypted restic backups;
  - role-based access;
  - no submission contents, credentials or named ballots in logs.
- **Breach plan (Art. 33 DSGVO):** who notifies the supervisory authority within 72 hours.
- **DSFA:** probably not required at this scale; write one paragraph saying why.
- **Data protection officer:** not required below 20 people regularly processing data (§ 38 BDSG).

## 5. Known gaps in the code

- **Erasure (Art. 17 DSGVO):** `DELETE /api/v1/admin/users/{id}` refuses anyone with submissions, votes or activity (`has_content`). Uploads are immutable and not physically removed in v1 (see `ops/README.md`). A real deletion request therefore needs a manual procedure, or a new erasure feature that also removes upload files. Backups still hold the data until their snapshots expire.
- **Data export (Art. 15/20 DSGVO):** no self-service export. Handle requests manually for now.
- **No Impressum or Datenschutz page** exists yet.

## Verified in the repo

These were checked on 2026-11-16:

- No external fonts, scripts or analytics in `deployables/portal/web` or `deployables/auth`.
- Caddy has no `log` directive, so it writes no access logs (`deployables/caddy/Caddyfile`).
- The only browser storage is localStorage UI preferences.
- Brevo delivery refuses to start until the tracking-off setting is confirmed.
- Email audit stores metadata only and prunes it after 90 days.
