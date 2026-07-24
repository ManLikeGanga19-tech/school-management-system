# Playbook — Onboarding a Second Platform onto the Contabo VPS

> Enterprise migration + co-hosting playbook, distilled from the ShuleHQ
> Render/Vercel → Contabo migration (tagged `v1.0.0`, 2026-07-23/24).
>
> **Use this for the new AI-agent platform.** It covers three things:
> 1. what already exists on the box that you reuse (don't rebuild),
> 2. the migration steps that are proven to work, and
> 3. the isolation rules that keep the new platform from ever harming ShuleHQ —
>    which serves live, paying schools.
>
> Copy this file into the new project's repo and adapt the names.

---

## 0. The one rule that overrides everything

**ShuleHQ is live production with paying clients. The new platform must never be
able to degrade it.** Every decision below is subordinate to that. When in
doubt, isolate harder: separate database, separate Docker network, hard resource
caps, separate deploy path, separate secrets. The two systems share a box and
nothing else.

An AI-agent workload makes this sharper than a normal app: agents can loop, spawn
work, hold memory, and burn CPU and money in ways ordinary request/response code
does not. Treat the agent tier as **hostile to its neighbours by default** and
fence it in.

---

## 1. What already exists on the VPS (reuse — do NOT rebuild)

| Component | Status | How the new platform uses it |
|---|---|---|
| **Contabo VPS** `94.72.102.13` | hardened (UFW 22/80/443, fail2ban, unattended-upgrades, 4 GB swap, SSH keys only, root login off) | New platform is more containers on the same host. |
| **Caddy** (edge, `:80/:443`) | wildcard TLS `*.shulehq.co.ke` via Cloudflare DNS-01 | Add a new site block for the new domain/subdomain. If it's a **different** registered domain, use ordinary HTTP-01. |
| **Cloudflare** | authoritative DNS, proxy ON, WAF Managed Challenge, Turnstile | Add DNS records + reuse the same challenge/exclusion patterns. |
| **PostgreSQL 18** (`sms-postgres`) | one shared instance | **Separate database + separate role**, same instance. Not a second Postgres container. |
| **Redis** (`sms-redis`) | shared | Use a **different logical DB index** (`redis://…/1`) or a separate instance if the agent load is heavy. |
| **GHCR image pipeline** | build-in-CI, ship-to-box | Replicate the pattern with new image names. |
| **Watchdog** (GitHub Actions) | external uptime/TLS/backup monitoring | Add the new platform's endpoints as new checks. |
| **Backup tooling** | `/usr/local/bin/shulehq-backup` nightly + offsite pull | Extend to dump the new database too (see §7). |

**Docs to read first (all in `docs/ops/`):** `DEPLOYMENT_ARCHITECTURE.md`,
`CUTOVER_RUNBOOK.md`, `BACKUP_RESTORE_RUNBOOK.md`, `RESTORE_DRILL_LOG.md`.

---

## 2. Capacity budget (8 GB box — plan before you deploy)

ShuleHQ *uses* ~1.2 GB but its container **ceilings sum to ~5.7 GB**. Ceilings
are limits, not reservations — but if both platforms burst to their ceilings at
once, the OOM killer fires and **it does not know which container earns your
revenue**. So:

- **Give the new platform hard `cpus` and `mem_limit` on every container.**
- **Keep the sum of all ceilings under ~7 GB**, leaving ~1 GB for the OS.
- If the AI tier needs more than fits, **right-size ShuleHQ's generous ceilings
  down first** (it runs comfortably in far less), or move the new platform to its
  own small VPS while it stabilises.

Suggested starting ceilings for the new platform (tune with a load test, per §6
of the migration story):

| Container | cpus | mem_limit | Notes |
|---|---|---|---|
| backend/api | 1.0 | 512m | raise only if a load test proves the need |
| frontend | 0.5 | 512m | static export → near zero |
| **agent worker(s)** | **1.0 hard** | **1024m hard** | the dangerous one — never unbounded |
| (shared postgres/redis/caddy) | — | — | already budgeted under ShuleHQ |

> A rule learned the hard way on ShuleHQ: an under-provisioned cap is invisible
> until load arrives, then it throttles hard. Measure with `wrk`, watch
> `/sys/fs/cgroup/cpu.stat` `nr_throttled`, and size from evidence — not a guess.

---

## 3. Isolation checklist (the heart of co-hosting)

- [ ] **Separate deploy path** — `/opt/<newapp>`, never `/opt/shulehq`.
- [ ] **Separate compose project** — own `docker-compose.prod.yml`; run with
      `-p <newapp>` so container/volume/network names never collide.
- [ ] **Separate Docker networks** — the new app's containers must not share a
      network with ShuleHQ's. Only the shared Postgres/Redis are reached, and
      only over their own network attachment.
- [ ] **Separate database + role** in the shared Postgres:
      ```sql
      CREATE ROLE <newapp> LOGIN PASSWORD '<strong>';
      CREATE DATABASE <newapp> OWNER <newapp>;
      -- new role has NO access to the shulehq database; verify:
      -- \c shulehq  then  SET ROLE <newapp>;  SELECT * FROM core.tenants; -> must be denied
      ```
- [ ] **Separate Redis logical DB** (`/1`) or instance; never share key space.
- [ ] **Hard resource caps** on every container (§2).
- [ ] **Separate GitHub Environment + secrets** (`production-<newapp>`), separate
      `PRODUCTION_ENV_FILE`. Never reuse ShuleHQ's secrets.
- [ ] **Separate subdomain/domain** with its own Caddy block.
- [ ] **Separate backup schedule/target** (§7).
- [ ] **Deploy safety:** verify a ShuleHQ health check **before and after** every
      new-platform deploy, so you catch any shared-resource impact immediately.

---

## 4. AI-agent-specific guardrails (new — not covered by ShuleHQ)

Agents introduce failure modes ordinary web apps don't. Address each explicitly.

### 4.1 Secrets & keys
- [ ] Anthropic/Claude API key in the env file only, **gitignored**, never
      committed. Same discipline as ShuleHQ (`.gitignore` covers `*.env`,
      `deploy/.env.production`).
- [ ] Scope the key to the new project; **rotate on a schedule** and after any
      exposure. Keep it out of logs (agents love to echo their config).
- [ ] Store a copy in a password manager — losing it strands the platform.

### 4.2 Runaway / cost control (money, not just CPU)
- [ ] **Hard per-run token/step budgets** and a **wall-clock timeout** on every
      agent invocation. An agent with no ceiling is an open invoice.
- [ ] **Concurrency cap** — a bounded worker pool, not "spawn on demand." This is
      also what protects ShuleHQ's CPU share.
- [ ] **Spend alerting** — surface daily token/$ spend to the same pager (ntfy)
      the watchdog uses; alert on anomalies.
- [ ] **Idempotency + retry limits** — cap retries so a failing agent can't loop
      forever billing tokens.

### 4.3 Architecture — keep agents OUT of the request path
- [ ] Agent work runs in a **separate worker/queue**, not inside HTTP handlers.
      A long agent run must never hold a web worker or a DB connection open.
- [ ] Use a job queue (Redis-backed is fine on the shared Redis, separate DB
      index). The API enqueues; workers process; results are polled/streamed.
- [ ] **Backpressure:** a full queue rejects or defers rather than piling work
      that starves the box.

### 4.4 Egress & network
- [ ] Agents call `api.anthropic.com` — outbound 443 is already allowed (UFW
      default allow outgoing). Do **not** open new inbound ports; everything
      still enters via Caddy.
- [ ] If the agent can call arbitrary tools/URLs, constrain that surface — an
      agent with unrestricted egress on a box next to live client data is a
      real risk. Allowlist where practical.

### 4.5 Data separation
- [ ] Agent data (prompts, transcripts, outputs) lives in the **new platform's
      database only**. It must have **no path** to ShuleHQ's tenant data.
- [ ] If agents process PII, apply the same care as ShuleHQ backups
      (encryption at rest for offsite copies; Kenya DPA awareness).

---

## 5. Migration sequence (proven on ShuleHQ)

Mirror the phased approach; each phase gates the next.

**Phase 1 — Safety net first.** Ensure the *source* (Render/Vercel/other) is
backed up and the backup is **restore-verified** before touching anything. "The
backup you have never restored does not exist."

**Phase 2 — Provision (mostly done).** The VPS is already hardened. You only add:
new deploy path, new DB + role, new Caddy block, new GitHub environment+secrets,
new image names in CI.

**Phase 3 — Dress rehearsal.** Deploy to the VPS with production untouched.
Restore a **copy** of source data into the new database. Smoke-test over real
HTTPS via a browser `--host-resolver-rules` override (no `/etc/hosts` edits
needed). **Do not skip this** — on ShuleHQ the rehearsal surfaced six real
defects that would otherwise have hit during cutover.

**Phase 4 — Cutover.** Maintenance window → suspend source writes → **final**
backup → restore → migrate → verify row counts match source exactly → flip DNS
(grey cloud / DNS-only if Caddy terminates TLS) → verify from outside. Keep the
source suspended-not-deleted as rollback.

**Phase 5 — Burn-in & decommission.** Watch 24–48 h. Confirm automated backups
fire **unattended**. Take a final archival dump of the source. **Only then**
decommission the source.

Full detail + exact commands: `docs/ops/CUTOVER_RUNBOOK.md`.

---

## 6. The gotchas we already paid for (don't repeat them)

Every one of these cost real time on ShuleHQ. They are free to avoid now.

1. **Ship images, don't pull them on the box.** CI builds and `docker save`s the
   images into the deploy bundle; the VPS `docker load`s them. The VPS has no
   GHCR credentials. Pulling a private image on the box fails the deploy.
2. **Ship every bind-mounted file** (e.g. the Caddyfile). A missing bind source
   makes Docker silently create an empty directory.
3. **PostgreSQL 18 images** store data in a version subdirectory — mount the
   volume at `/var/lib/postgresql`, **not** `/var/lib/postgresql/data`, or the
   container refuses to start.
4. **`pg_dump` major version must be ≥ the server.** A v16 client cannot dump a
   v18 server. Dump *from the VPS* (which has pg18 client) to sidestep this.
5. **One deploy path only.** Two workflows deploying the same host race and
   confuse each other. Delete duplicates.
6. **Migrations ONLY via CI.** Never `docker cp` a migration into a running
   container — it desyncs the DB from the image and breaks the next start.
   (This caused a ~15-minute ShuleHQ outage.)
7. **Rate-limit on the real client IP** (`CF-Connecting-IP` → left-most
   `X-Forwarded-For` → peer), not the proxy. Keying on the proxy collapses all
   users into one bucket — a trivial DoS and self-inflicted lockout.
8. **External services fail OPEN** on the login path (Turnstile, CAPTCHA). A
   third-party outage must not lock users out; log loudly and allow, since
   passwords + rate limiting still apply.
9. **Monitor from OUTSIDE the box** (GitHub Actions), never on the host it
   watches. And a Cloudflare challenge is not an outage — treat `403 +
   cf-mitigated` as healthy.
10. **Runtime config, not build-time, for values that change.** `NEXT_PUBLIC_*`
    is inlined at build; read changeable keys at runtime in a server component
    instead, to avoid a rebuild per change.
11. **Backups before decommission.** Never retire the source until the new
    platform's own backups have run **unattended** and been verified.

---

## 7. Backups for the new platform

Extend, don't reinvent. Two clean options:

- **Preferred:** parameterise `deploy/backup-nightly.sh` (or copy it) to also
  dump the new database + its media, producing its own artifact with its own
  retention. Same restore-safety guards (verify TABLE DATA exists before
  recording; sha256 per part).
- Add the new artifact to the offsite pull (`pull-backup-to-local.sh`) and to
  the watchdog's daily freshness check.
- **Do a restore drill** for the new platform before it carries real data, and
  log it in a `RESTORE_DRILL_LOG.md`.
- Consider the **PC-independent offsite** (Cloudflare R2 push) so "offsite" does
  not depend on a workstation being awake.

---

## 8. Definition of done (per platform)

- [ ] Live on Contabo, data verified row-for-row against source
- [ ] Wildcard/host TLS valid; monitored (edge **and** origin cert)
- [ ] Automated backup fired **unattended**, restore-verified, offsite copy taken
- [ ] External watchdog covers its endpoints; paging tested
- [ ] Hard resource caps on every container; ShuleHQ health unaffected under the
      new platform's load (proven with a load test)
- [ ] Agent tier: token/time/concurrency budgets + spend alerting in place
- [ ] Secrets gitignored; source decommissioned only after burn-in
- [ ] Tagged release; ops docs written

---

## 9. Quick reference — shared infra facts

```
VPS:            94.72.102.13  (Ubuntu 24.04, deploy user "deploy", /opt/<app>)
SSH:            ~/.ssh/shulehq_admin_key   (admin);  CI key in GitHub secrets
Edge:           Caddy, wildcard *.shulehq.co.ke via Cloudflare DNS-01
DNS:            Cloudflare (authoritative); A records DNS-only if Caddy does TLS;
                never remove the letsencrypt.org CAA record
Postgres:       18, shared instance sms-postgres — new DB + new role per platform
Deploy:         build in CI -> docker save -> ship -> docker load -> compose up
Monitoring:     GitHub Actions watchdog (external); ntfy paging
Never:          pull private images on the box · docker cp migrations ·
                unbounded agent workers · share a DB/role/network with ShuleHQ
```
