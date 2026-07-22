# ShuleHQ — System Inventory (System of Record)

> **Purpose.** The authoritative list of everything that constitutes "production."
> Nothing is migrated, backed up, or restored unless it appears here. Review and
> update this document *before* any infrastructure change (migration, restore
> drill, scaling). Last verified against the codebase on the date of the commit
> that introduced this file.
>
> **Status:** DRAFT for review — Phase 1 of the Contabo migration preparation.

---

## 1. Runtime services

Current dev topology (`docker-compose.yml`). The Contabo production topology adds
the billing app + 5 marketing sites behind the same nginx/Caddy (see the
migration plan), but the SaaS runtime is these six units:

| Service | Image (pin) | Purpose | Stateful? | Notes |
|---|---|---|---|---|
| `postgres` | `postgres:16.4-alpine` (dev) / **v18 on Render prod** | Primary data store — 86 tables in schema `core` | **Yes** | ⚠️ **Version skew**: dev ships client/server 16; Render server is 18. Standardize on **18** on the VPS (server + client tools together). |
| `redis` | `redis:7.4-alpine` | Session cache, rate-limit counters, circuit-breaker state | No (rebuildable) | Loss = users re-login; no business data. Password-protected (`REDIS_PASSWORD`). |
| `db-migrate` | `school-erp-backend:dev` | One-shot `alembic upgrade heads` on deploy | No | Exits 0. Head = `kem1u2l3i4x5`. |
| `backend` | `school-erp-backend:dev` (FastAPI/uvicorn) | API — all business logic | No (state in Postgres) | Serves `/api/v1`. `WEB_CONCURRENCY` tunable. |
| `frontend` | `school-erp-frontend:dev` (Next.js) | Tenant + admin + marketing UI | No | Reads `NEXT_PUBLIC_*` at **build** time. |
| `nginx` | `school-erp-nginx:dev` | Reverse proxy / TLS termination | No | Routes host → service. TLS moves here on the VPS. |

**Build provenance (production rule):** images are built in **CI (GitHub Actions)**,
pushed to a registry, and `docker pull`ed on the box. The VPS never compiles.

---

## 2. Data stores — what is precious vs. rebuildable

This is the section that matters most for "never lose tenant work."

| Store | Location | Contains | Backup priority | If lost |
|---|---|---|---|---|
| **PostgreSQL** | `postgres_data` volume | All tenants, users, students, enrollments, invoices, payments, carry-forward, scholarships, attendance, audit logs (86 tables) | **CRITICAL — RPO target ≤ 24h, aim ≤ 1h** | Catastrophic: tenant financial + student records gone |
| **Student documents** | `./backend/media/student-docs/` → `/app/media/student-docs` | Uploaded files: birth certs, parent IDs, transfer letters, report cards | **CRITICAL** | ⚠️ **NOT in Postgres.** A DB-only backup silently loses every uploaded document. Backup MUST cover this directory. |
| **Redis** | `redis_data` volume | Sessions, rate counters, breaker state | None | Users re-login; self-heals |
| **Brand/static assets** | Baked into images / repo | Logos, icons | None (in git) | Rebuild from repo |

> **Design consequence:** a "complete backup" = **Postgres logical dump + the
> `student-docs` directory**, captured as one consistent set. This is codified in
> the Backup & Restore Runbook.

---

## 3. Secrets & environment variables

Grouped by domain. **Sensitive** values must be moved via a secure channel at
migration (never committed, never logged). On the VPS they live in a root-owned
`.env` (`chmod 600`) referenced by compose.

### 3.1 Core / platform
| Var | Sensitive | Notes |
|---|---|---|
| `APP_ENV` | No | `dev` \| `staging` \| `production` |
| `APP_NAME` | No | |
| `DATABASE_URL` | **Yes** | Postgres DSN (user/pass/host/db) |
| `DB_SSL_MODE` | No | Set `require` in prod (managed PG) or `disable` (same-host VPS) |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_TIMEOUT_SEC` / `DB_POOL_RECYCLE_SEC` / `DB_POOL_PRE_PING` | No | Connection-pool tuning — size for the VPS |
| `REDIS_URL` | **Yes** (host) | |
| `REDIS_PASSWORD` | **Yes** | |
| `JWT_SECRET` | **Yes** 🔑 | Signing key — **rotating it logs everyone out**. Move verbatim. |
| `JWT_ACCESS_TTL_MIN` / `JWT_REFRESH_TTL_DAYS` | No | |
| `PUBLIC_OAUTH_SHARED_SECRET` | **Yes** | |
| `TENANT_MODE` | No | Multi-tenant resolution mode |
| `AUDIT_LOG_RETENTION_DAYS` | No | Pruning window |
| `RATE_LIMIT_TENANT_PER_MINUTE` | No | |

### 3.2 Web / cookies / CORS  (the class of bug that broke the scanner — get these exact)
| Var | Sensitive | Notes |
|---|---|---|
| `CORS_ORIGINS` | No | Exact allowed origins (marketing + admin hosts) |
| `CORS_BASE_DOMAIN` | No | **Must be `shulehq.co.ke`** to allow tenant subdomains (HTTPS-only regex) |
| `COOKIE_DOMAIN` | No | e.g. `.shulehq.co.ke` |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | No | `Secure` cookies require HTTPS end-to-end |
| `NEXT_PUBLIC_API_BASE_URL` | No | **Build-time** — `https://api.shulehq.co.ke/api/v1`. Wrong value = every verify/API call 404s. |
| `NEXT_PUBLIC_TENANT_BASE_HOST` | No | Tenant subdomain base |

### 3.3 M-Pesa / Daraja
`DARAJA_ENV`, `DARAJA_CONSUMER_KEY` 🔑, `DARAJA_CONSUMER_SECRET` 🔑, `DARAJA_PASSKEY` 🔑,
`DARAJA_SHORTCODE`, `DARAJA_CALLBACK_BASE_URL` ⚠️, `DARAJA_CALLBACK_TOKEN` 🔑,
`DARAJA_CALLBACK_HMAC_SECRET` 🔑, `DARAJA_DEDUP_WINDOW_SEC`, `DARAJA_TIMEOUT_SEC`,
`DARAJA_USE_MOCK`, `DARAJA_SANDBOX_FALLBACK_TO_MOCK`.

> ⚠️ **Cutover action:** `DARAJA_CALLBACK_BASE_URL` and the callback registered
> with Safaricom point at the **current host**. When DNS/host changes, the
> callback URL must be re-registered or M-Pesa confirmations stop arriving.

### 3.4 SMS — Africa's Talking
`AT_USERNAME`, `AT_API_KEY` 🔑, `AT_SENDER_ID`, `AT_SANDBOX`, `AT_USE_MOCK`,
`AT_TIMEOUT_SEC`, `AT_UNITS_PER_SEGMENT`, `AT_CHARS_PER_SEGMENT`.

> ⚠️ Africa's Talking may **IP-allowlist** API callers. If so, add the VPS IP
> before cutover or outbound SMS (fee reminders, absentee roll-call alerts) fail.

---

## 4. Domains & DNS

| Host | Serves | Notes |
|---|---|---|
| `shulehq.co.ke` / `www` | Marketing / public | |
| `api.shulehq.co.ke` | Backend API | Separate host from frontend — the reason `NEXT_PUBLIC_API_BASE_URL` must be explicit |
| `admin.shulehq.co.ke` | SaaS admin portal | |
| `*.shulehq.co.ke` | Tenant workspaces (per-school subdomain) | Needs **wildcard TLS** |
| (5 marketing domains) | Static Next.js sites | To be static-exported, served by nginx |

**Migration prerequisite:** lower DNS TTL to 60s several days before cutover so
the switch is fast and reversible.

---

## 5. Version pins (must match at every tier)

| Component | Version | Rule |
|---|---|---|
| PostgreSQL **server** | 18 (Render prod) | VPS runs **18** |
| PostgreSQL **client** (`pg_dump`/`psql`/`pg_restore`) | **18** | ⚠️ `pg_dump` **16 cannot dump an 18 server**. Backup tooling must use v18 client. |
| Redis | 7.4 | |
| Alembic head | `kem1u2l3i4x5` | Restore then `alembic upgrade heads` |
| Node/Next, Python | per Dockerfile | Pinned in images built by CI |

---

## 6. Persistent volumes (what survives a container rebuild)

| Volume / path | Backed up? | Notes |
|---|---|---|
| `postgres_data` | via logical dump | Do **not** rely on raw volume copies across PG major versions |
| `./backend/media/student-docs` | **Yes — directory archive** | The non-DB critical asset |
| `redis_data` | No | Rebuildable |
| `frontend_node_modules` | No | Build artifact |

---

## 7. Open risks flagged during inventory

1. **Media on local disk** — uploaded documents are a second critical data store
   outside Postgres. Long-term, consider moving to Object Storage (S3-compatible)
   so backups and multi-node scaling are trivial. Short-term, the backup must
   archive the directory.
2. **Postgres exposed `0.0.0.0/0` on Render** — on the VPS, bind Postgres to the
   Docker network only; never publish 5432 to the internet.
3. **Single VPS = single point of failure** — mitigated by Contabo Auto Backup
   (whole-image) **plus** the logical backup system (this project). Both, not
   either.
4. **`JWT_SECRET` continuity** — must be carried over verbatim or every session
   is invalidated at cutover.
5. **Build-time frontend env** — `NEXT_PUBLIC_*` are compiled in; a rebuilt image
   with wrong values ships a broken frontend. CI must inject the production values.

---

*End of inventory. Changes to production topology must update this file in the
same PR.*
