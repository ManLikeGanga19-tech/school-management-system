# ShuleHQ — Deployment Architecture (Contabo VPS)

> **Phase 2 of the migration.** How the production SaaS runs on a single
> Contabo Cloud VPS 4 (4 vCPU / 8 GB / 100 GB). Reviewed before provisioning.
>
> **What already existed** (and we keep): a GHCR image pipeline
> (`ci.yml`), an SSH-based `deploy-production.yml` that ships
> `docker-compose.prod.yml` + a composed `.env` to `PRODUCTION_SSH_HOST` and
> runs `docker compose up -d`, `127.0.0.1`-bound service ports, per-service
> CPU/memory limits, and Dozzle for logs. The deploy mechanism was built for
> a VPS, not Render — so pointing it at Contabo is largely configuration.
>
> **What Phase 2 adds/fixes:** a public TLS edge (Caddy) incl. tenant
> subdomains, the media-persistence fix, Postgres 18, a hardened
> provisioning script, and the production env template.

---

## 1. Topology

```
                          Internet (HTTPS :443 / :80)
                                    │
                          ┌─────────▼─────────┐
                          │   Caddy (edge)    │  auto-TLS, HTTP→HTTPS,
                          │   :80 :443        │  routes by Host header
                          └─────────┬─────────┘
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                            │
  api.shulehq.co.ke        shulehq.co.ke / www          <tenant>.shulehq.co.ke
  admin.shulehq.co.ke      (marketing/public)           admin.shulehq.co.ke
        │                           │                            │
        ▼                           ▼                            ▼
  ┌───────────┐              ┌────────────┐               (frontend resolves the
  │  backend  │◀────────────▶│  frontend  │                tenant from the host;
  │  :8000    │   internal   │  :3000     │                same frontend service)
  └─────┬─────┘   nginx      └────────────┘
        │         (static/cache)
        ▼
  ┌───────────┐     ┌──────────┐
  │ postgres  │     │  redis   │      All app/data ports bound to 127.0.0.1 —
  │  18 :5432 │     │  :6379   │      only Caddy is reachable from the internet.
  └───────────┘     └──────────┘
        │
        ▼
  volumes: postgres_data · redis_data · backend_media · backend_storage

  ┌──────────────── same VPS, added in Phase 5 ────────────────┐
  │  billing app (own frontend/backend, SHARED postgres 18)     │
  │  5 marketing sites (static export → served by Caddy)        │
  └────────────────────────────────────────────────────────────┘
```

**Trust boundary:** only Caddy listens publicly (80/443). Postgres, Redis,
backend, frontend, internal nginx, and Dozzle stay on `127.0.0.1` /the Docker
networks. UFW blocks everything except 22/80/443.

---

## 2. TLS strategy — the one real design decision

Fixed hostnames and dynamic tenant subdomains are handled differently:

| Hostnames | Strategy | Why |
|---|---|---|
| `shulehq.co.ke`, `www`, `api.`, `admin.`, the 5 marketing domains | **Automatic TLS (HTTP-01)** | Known, finite set — Caddy issues + renews with zero config |
| `<tenant>.shulehq.co.ke` (unbounded, grows as schools onboard) | **On-demand TLS, gated by an ask endpoint** | A cert is minted the first time each tenant subdomain is hit; no wildcard, no DNS-provider API token, scales to unlimited tenants automatically |

**Why on-demand over a wildcard cert:**
- **No external dependency** — a wildcard needs a DNS-provider API token + a
  custom Caddy build with a DNS plugin. On-demand uses stock Caddy and only
  needs the subdomain's A record pointing at the VPS (which you set anyway).
- **Abuse-safe** — Caddy asks the backend
  `GET /api/v1/public/tls-authorize?domain=<host>` before issuing; the backend
  returns 200 only for the apex/www/api/admin/marketing hosts or a host whose
  subdomain matches an **active tenant**. An attacker pointing `evil.com` at
  the IP gets no cert (and no Let's Encrypt rate-limit burn).

> **Alternative (if ever preferred):** a wildcard `*.shulehq.co.ke` via DNS-01.
> Requires a DNS-provider API token + a Caddy image built with that provider's
> plugin. The Caddyfile notes where this swaps in. Not needed for launch.

DNS records to create (all → the VPS IPv4):
`shulehq.co.ke`, `www`, `api`, `admin`, each marketing domain, and a
**wildcard `*.shulehq.co.ke`** A record so any tenant subdomain resolves.

---

## 3. Data persistence (the "never lose work" contract at the infra layer)

| Volume | Path | Holds | Note |
|---|---|---|---|
| `postgres_data` | pg data dir | the database | backed up logically (Phase 1) |
| `backend_media` | `/app/media` | **student documents** | **NEW in Phase 2** — was missing; uploads were on ephemeral container FS and lost on redeploy |
| `backend_storage` | `/app/storage` | tenant badges | existed |
| `redis_data` | redis AOF | cache | rebuildable |
| `caddy_data` / `caddy_config` | Caddy | issued certs | so renewals/certs survive restarts |

The image now `mkdir`s + chowns `/app/media` so the non-root app user can write
to the mounted volume.

---

## 4. Capacity plan (8 GB)

`mem_limit` sums (this SaaS): postgres 512m + redis 256m + backend 512m +
frontend 512m + nginx 128m + caddy ~64m + dozzle 64m ≈ **~2.0 GB**. Leaves
~6 GB for OS, the billing app, the marketing sites, and burst. Conditions from
the capacity review still hold: **build in CI (never on the box)**, **add
swap**, **static-export the marketing sites**, **one shared Postgres** for
SaaS + billing (separate databases).

---

## 5. CI/CD (already built — what changes)

`deploy-production.yml` already: builds/pushes GHCR images, composes the env,
scp's `docker-compose.prod.yml` + `.env` to the host, runs `docker compose
up -d --wait`. **To retarget Contabo, only GitHub secrets change** (see
`deploy/GITHUB_SECRETS.md`): point `PRODUCTION_SSH_HOST` at the VPS, set the
deploy user + key + path, and paste the production env as `PRODUCTION_ENV_FILE`.
No workflow code change required. The Caddy edge is added to the prod compose,
so it deploys through the same pipeline.

---

## 6. Provisioning & hardening (`deploy/provision.sh`)

Run once on the fresh Ubuntu VPS: create a non-root deploy user with the CI
public key, disable SSH password + root login, UFW (22/80/443 only), fail2ban,
`unattended-upgrades`, install Docker + compose plugin, add **4 GB swap**, set
up the deploy directory. Idempotent — safe to re-run.

---

## 7. Cutover fit (Phase 4 preview)

Once this is provisioned and a dress rehearsal passes: lower DNS TTL → brief
maintenance window → final backup from Render → restore into VPS Postgres 18 →
`deploy-production.yml` (or manual compose up) → flip DNS → re-point Daraja/SMS
callbacks → Restore Drill #2 against real prod data → burn-in → decommission
Render.

---

## 8. Open items requiring your input

1. **DNS** — create the A records in §2 (incl. wildcard `*.shulehq.co.ke`) once
   you have the VPS IP. Needed before TLS can issue.
2. **Daraja + Africa's Talking** — the M-Pesa callback URL re-registration and
   any SMS IP-allowlisting to the VPS IP (Phase 4 cutover checklist).
3. **Confirm TLS approach** — on-demand (recommended, default) vs wildcard.
   Only matters if you specifically want wildcard.
