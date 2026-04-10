# ShuleHQ — School Management System

> Multi-tenant SaaS platform for Kenyan schools. Manage enrolments, fees, M-Pesa billing, staff, and compliance from a single cloud dashboard.

<p align="center">
  <a href="https://github.com/ManLikeGanga19-tech/school-management-system/actions/workflows/ci.yml">
    <img src="https://github.com/ManLikeGanga19-tech/school-management-system/actions/workflows/ci.yml/badge.svg?branch=staging" alt="CI" />
  </a>
  <img src="https://img.shields.io/badge/python-3.12-blue?logo=python" alt="Python 3.12" />
  <img src="https://img.shields.io/badge/next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/postgres-16.4-blue?logo=postgresql" alt="PostgreSQL 16.4" />
  <img src="https://img.shields.io/badge/redis-7.4-red?logo=redis" alt="Redis 7.4" />
  <img src="https://img.shields.io/badge/docker-compose-blue?logo=docker" alt="Docker Compose" />
  <img src="https://img.shields.io/badge/license-proprietary-lightgrey" alt="License" />
</p>

---

## Table of Contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Local Development](#local-development)
  - [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [CI/CD Pipeline](#cicd-pipeline)
- [Deployment](#deployment)
  - [Staging](#staging)
  - [Production](#production)
- [Security](#security)
- [M-Pesa / Daraja Integration](#m-pesa--daraja-integration)
- [Backup & Recovery](#backup--recovery)
- [Development Roadmap](#development-roadmap)
- [Contributing](#contributing)

---

## Overview

ShuleHQ is a multi-tenant cloud platform built for Kenyan schools. A single **SaaS operator** (platform admin) provisions school tenants. Each school gets:

- A **Director** portal for enrolment management, fee structures, finance oversight, and staff.
- A **Secretary** portal for day-to-day fee collection and payment recording.
- Integrated **M-Pesa (Daraja STK Push)** for cashless tuition payments.
- Full **RBAC**, **audit logging**, and **data isolation** per tenant.

All portals are served from a single Next.js application, with portal identity resolved from the request's subdomain (e.g. `greenhill.shulehq.co.ke`).

---

## Screenshots

> **Note:** Replace the placeholder paths below with actual screenshots once captured.

### SaaS Admin — Dashboard
![SaaS Dashboard](docs/screenshots/saas-dashboard.png)

### SaaS Admin — Tenant Management
![Tenant Management](docs/screenshots/saas-tenants.png)

### SaaS Admin — Subscriptions & Billing
![Subscriptions](docs/screenshots/saas-subscriptions.png)

### SaaS Admin — RBAC Roles & Permissions
![RBAC](docs/screenshots/saas-rbac.png)

### SaaS Admin — Audit Log
![Audit Log](docs/screenshots/saas-audit.png)

### SaaS Admin — Academic Calendar
![Academic Calendar](docs/screenshots/saas-calendar.png)

### Director Portal — Dashboard
![Director Dashboard](docs/screenshots/director-dashboard.png)

### Director Portal — Enrolments
![Enrolments](docs/screenshots/director-enrollments.png)

### Director Portal — Fee Structures
![Fee Structures](docs/screenshots/director-finance-fees.png)

### Director Portal — Invoices
![Invoices](docs/screenshots/director-finance-invoices.png)

### Secretary Portal — Dashboard
![Secretary Dashboard](docs/screenshots/secretary-dashboard.png)

### Secretary Portal — Finance
![Secretary Finance](docs/screenshots/secretary-finance.png)

### Prospect / Public — Registration
![Prospect Registration](docs/screenshots/public-register.png)

### Mobile — M-Pesa STK Push Prompt
![M-Pesa STK Push](docs/screenshots/mpesa-stk-push.png)

---

## Architecture

```
                          ┌─────────────────────────────────┐
                          │         Caddy (TLS proxy)        │
                          │   443 → 127.0.0.1:8081 (nginx)  │
                          └────────────────┬────────────────┘
                                           │
                          ┌────────────────▼────────────────┐
                          │            Nginx                 │
                          │  /* → frontend:3000              │
                          │  /api/v1/* → backend:8000        │
                          │  Security headers, rate limit     │
                          └──────┬─────────────┬────────────┘
                                 │             │
               ┌─────────────────▼──┐    ┌────▼───────────────────┐
               │   Next.js 16        │    │   FastAPI (Gunicorn)    │
               │   React 19          │    │   Python 3.12           │
               │   TypeScript 5      │    │   SQLAlchemy 2 + Alembic│
               │   Tailwind CSS 4    │    │   slowapi rate limiting │
               │   TanStack Query    │    │   JWT auth + RBAC       │
               │   next-intl (i18n)  │    │   Async audit logger    │
               └─────────────────────┘    └────────┬───────────────┘
                                                   │
                             ┌─────────────────────┼──────────────────┐
                             │                     │                  │
                   ┌─────────▼────────┐  ┌─────────▼────────┐  ┌────▼──────────┐
                   │  PostgreSQL 16.4  │  │   Redis 7.4       │  │   Safaricom   │
                   │  core schema      │  │  Sessions cache   │  │   Daraja API  │
                   │  Alembic migs     │  │  Rate limiting    │  │   M-Pesa STK  │
                   │  JSONB payloads   │  │  Token blacklist  │  │   Push/Query  │
                   └──────────────────┘  └──────────────────┘  └───────────────┘
```

### Multi-Tenant Resolution

Every request to the FastAPI backend is processed by `TenantMiddleware`, which resolves the active tenant in priority order:

1. `X-Tenant-ID` header (UUID)
2. `X-Tenant-Slug` header
3. **Subdomain matching** — `{slug}.shulehq.co.ke` maps to the school's `Tenant` record

Public paths (health checks, SaaS auth, payment callbacks) bypass tenant resolution entirely.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | Next.js | 16 |
| Frontend runtime | React | 19 |
| Frontend language | TypeScript | 5 |
| Styling | Tailwind CSS + Radix UI | 4 |
| Data fetching | TanStack React Query | 5 |
| Forms | react-hook-form + Zod | — |
| Charts | Recharts | — |
| i18n | next-intl | 3 |
| Animations | Framer Motion | — |
| Backend framework | FastAPI | 0.110+ |
| Backend language | Python | 3.12 |
| ORM | SQLAlchemy | 2.0 |
| Migrations | Alembic | — |
| Auth | python-jose + passlib (Argon2) | — |
| Rate limiting | slowapi | — |
| Production server | Gunicorn + Uvicorn workers | — |
| Database | PostgreSQL | 16.4 |
| Cache / sessions | Redis | 7.4 |
| Reverse proxy | Nginx | 1.x |
| Container runtime | Docker + Docker Compose | — |
| Image registry | GitHub Container Registry (GHCR) | — |
| CI/CD | GitHub Actions | — |
| TLS (hosting) | Caddy | 2 |
| Backup storage | Cloudflare R2 (S3-compatible) | — |

---

## Features

### SaaS Operator (Platform Admin)

| Feature | Description |
|---|---|
| **Tenant management** | Create, activate, deactivate, and configure school tenants |
| **Subscription billing** | Manage per-tenant plans, billing cycles, discount overrides |
| **RBAC management** | Define roles and permissions platform-wide; assign to users |
| **Academic calendar** | Publish SaaS-level term dates that all schools inherit |
| **Audit log** | Full platform-level audit trail with 90-day retention |
| **Support desk** | Receive and respond to tickets raised by school administrators |
| **Rollout controls** | Feature flags and tenant onboarding workflow |

### Director (School Head)

| Feature | Description |
|---|---|
| **Dashboard** | Enrolment pipeline KPIs, fee collection summary, calendar view |
| **Enrolments** | Full DRAFT → SUBMITTED → APPROVED → ENROLLED workflow; delete incomplete applications |
| **Student profiles** | Full SIS profile — bio-data, guardian, emergency contacts, documents, discipline history |
| **Student hard-delete** | Permanent removal of student + all finance, exam, attendance, and discipline records with typed confirmation guard |
| **Attendance** | Class roster, session lifecycle (DRAFT → SUBMITTED → FINALIZED), bulk mark, corrections, reports |
| **8-4-4 Exams** | Exam setup, timetable, mark entry, marks review, A4 report card PDF generation |
| **CBC module** | Strand/sub-strand/learning outcome management, performance level assessments, progress report PDFs |
| **IGCSE module** | Subject management, A*–G grade entry per subject, individual and bulk class report PDFs |
| **Discipline** | Incident logging (type, severity, location), student links (PERPETRATOR/VICTIM/WITNESS), follow-up notes, status tracking |
| **Curriculum-gated nav** | Navigation automatically shows only 8-4-4 / CBC / IGCSE sections based on the school's curriculum type |
| **Fee structures (v2)** | Per-class schedules by academic year + student type with per-term amounts and charge-frequency rules |
| **Finance policies** | Partial-payment rules, minimum amounts, interview-fee gates |
| **Invoices (v2)** | Smart auto-generated invoices — student type auto-detected; once-per-year/once-ever items deduplicated |
| **Payment recording** | Cash, M-Pesa, bank transfer, cheque entries with printable receipts |
| **Scholarships** | Discount allocations per student (fixed or percentage), recipient tracking |
| **School calendar** | School-specific events overlaid on SaaS calendar |
| **Audit log** | Tenant-scoped action log for compliance |
| **Support** | Raise and track tickets with the platform operator |

### Secretary

| Feature | Description |
|---|---|
| **Dashboard** | Daily collection summary, outstanding balances |
| **Enrolments** | Create and manage student applications |
| **Student profiles** | View SIS profile, bio-data, guardian, emergency contacts, documents, discipline history |
| **Attendance** | Class attendance sessions, bulk mark, corrections |
| **Discipline** | Log and manage incidents, add student links and follow-up notes |
| **Finance (v2)** | Generate invoices, record payments, download PDF invoices and receipts |
| **Payment settings** | View and update tenant-level payment configuration |
| **CBC / IGCSE** | Manage curriculum assessments and view student reports |

### Prospect / Public

| Feature | Description |
|---|---|
| **Registration** | Self-register with email/password to request a school demo |
| **Requests** | Submit DEMO, ENQUIRY, or SCHOOL\_VISIT requests |
| **Authentication** | Access token + HttpOnly refresh cookie session management |

### Platform-Wide

| Feature | Description |
|---|---|
| **M-Pesa (Daraja)** | STK Push initiation, status polling, callback handling, deduplication |
| **Rate limiting** | Tenant-aware per-minute buckets (slowapi + Redis) |
| **Audit logging** | Async queue with sanitised payloads; auto-pruned at 90 days |
| **Session management** | Redis-backed token blacklist and permission cache |
| **Pure-Python PDF generation** | A4 PDF invoices, receipts, and fee-structure documents generated server-side with no external library dependencies |
| **i18n** | Cookie-based locale switching (next-intl) |
| **Structured logging** | JSON logs in non-dev environments |
| **Health checks** | `/healthz` (liveness) and `/readyz` (DB + Redis readiness) |

---

## Getting Started

### Prerequisites

| Tool | Minimum version |
|---|---|
| Docker Desktop | 4.x |
| Docker Compose | 2.x (bundled with Docker Desktop) |
| Node.js | 20.x (for running frontend outside Docker) |
| Python | 3.12 (for running backend outside Docker) |
| Git | any |

### Local Development

Everything runs inside Docker Compose — no local Python or Node installation required.

**1. Clone the repository**

```bash
git clone https://github.com/ManLikeGanga19-tech/school-management-system.git
cd school-management-system
```

**2. Create local environment files** (optional — defaults work for local dev)

```bash
# Root-level override (optional)
cp backend/.env.example backend/.env
```

**3. Start all services**

```bash
docker compose up --build
```

This will:
- Start PostgreSQL and Redis
- Run Alembic migrations automatically (`db-migrate` service)
- Start the FastAPI backend with hot-reload on `http://localhost:8000`
- Start the Next.js frontend on `http://localhost:3000`
- Start Nginx on `http://localhost:8080` (use this as your entry point)

**4. Access the portals**

| Portal | URL | Default credentials |
|---|---|---|
| SaaS Admin | `http://localhost:8080/saas/login` | `admin@shulehq.co.ke` / `Admin.45_` |
| Director | `http://novel-school.localhost:8080/login` | `director@demo.com` / `Admin.45_` |
| Secretary | `http://novel-school.localhost:8080/login` | `secretary@demo.com` / `Secretary.45_` |

> **Subdomain routing on localhost:** The Director/Secretary portals are resolved by subdomain. Add `novel-school.localhost` to your `/etc/hosts` (Linux/macOS) or use `127.0.0.1 novel-school.localhost` in `C:\Windows\System32\drivers\etc\hosts` (Windows). Alternatively, set `NEXT_PUBLIC_TENANT_BASE_HOST=localhost` (already the default in `docker-compose.yml`) and navigate to `http://novel-school.localhost:8080/login`.

**5. Stopping services**

```bash
docker compose down          # stop containers, keep volumes
docker compose down -v       # stop and remove all volumes (fresh start)
```

---

### Environment Variables

#### Backend (`backend/.env` or environment)

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_ENV` | no | `dev` | `dev` / `staging` / `ci` / `production` |
| `DATABASE_URL` | **yes** | — | PostgreSQL DSN (`postgresql+psycopg://...`) |
| `JWT_SECRET` | **yes** | — | Token signing key (min 32 chars) |
| `JWT_ACCESS_TTL_MIN` | no | `15` | Access token TTL (minutes) |
| `JWT_REFRESH_TTL_DAYS` | no | `30` | Refresh token TTL (days) |
| `TENANT_MODE` | no | `domain` | Tenant resolution strategy |
| `REDIS_URL` | no | `redis://redis:6379/0` | Redis DSN |
| `REDIS_PASSWORD` | no | `` | Redis auth password (empty = no auth) |
| `CORS_ORIGINS` | no | `http://localhost:3000,...` | Allowed origins (comma-separated) |
| `CORS_BASE_DOMAIN` | no | `` | Subdomain wildcard (e.g. `shulehq.co.ke`) |
| `COOKIE_SECURE` | no | `false` | Set `true` in HTTPS environments |
| `COOKIE_SAMESITE` | no | `lax` | SameSite cookie policy |
| `COOKIE_DOMAIN` | no | `` | Cookie domain for cross-subdomain auth |
| `DB_POOL_SIZE` | no | `10` | SQLAlchemy pool size |
| `DB_MAX_OVERFLOW` | no | `20` | SQLAlchemy overflow connections |
| `DB_SSL_MODE` | no | `` | `require` or `verify-full` for managed DBs |
| `RATE_LIMIT_TENANT_PER_MINUTE` | no | `2000` | Default rate limit per tenant bucket |
| `AUDIT_LOG_RETENTION_DAYS` | no | `90` | Auto-prune audit logs older than N days |
| `DARAJA_ENV` | no | `sandbox` | `sandbox` or `production` |
| `DARAJA_CONSUMER_KEY` | no | `` | Safaricom OAuth client ID |
| `DARAJA_CONSUMER_SECRET` | no | `` | Safaricom OAuth client secret |
| `DARAJA_SHORTCODE` | no | `` | Till or Paybill number |
| `DARAJA_PASSKEY` | no | `` | STK Push passkey |
| `DARAJA_CALLBACK_BASE_URL` | no | `` | Public base URL for M-Pesa callbacks |
| `DARAJA_CALLBACK_TOKEN` | no | `` | Token Safaricom must include in callbacks |
| `DARAJA_USE_MOCK` | no | `false` | Force mock Daraja provider |
| `DARAJA_SANDBOX_FALLBACK_TO_MOCK` | no | `false` | Fall back to mock if sandbox fails |
| `GUNICORN_WORKERS` | no | `2` | Gunicorn worker processes (production) |
| `GUNICORN_LOG_LEVEL` | no | `info` | Gunicorn log verbosity |

#### Frontend (Next.js)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | no | `/api/v1` | Browser-facing API base path |
| `BACKEND_BASE_URL` | no | `http://nginx/api/v1` | Server-side API base URL (internal) |
| `BACKEND_FETCH_TIMEOUT_MS` | no | `20000` | Server-side fetch timeout |
| `AUTH_LOGIN_TIMEOUT_MS` | no | `60000` | Login request timeout |
| `COOKIE_SECURE` | no | `false` | Set `true` in HTTPS environments |
| `NEXT_PUBLIC_TENANT_BASE_HOST` | no | `localhost` | Base host for subdomain tenant resolution |
| `NEXT_PUBLIC_PUBLIC_HOST` | no | — | Marketing site hostname |
| `NEXT_PUBLIC_ADMIN_HOST` | no | — | SaaS admin hostname |
| `NODE_ENV` | no | `development` | Node environment |

---

## Project Structure

```
school-management-system/
├── .github/
│   └── workflows/
│       └── ci.yml                  # CI/CD pipeline (test → build → deploy)
│
├── backend/
│   ├── app/
│   │   ├── api/v1/
│   │   │   ├── admin/              # SaaS operator endpoints
│   │   │   ├── attendance/         # Class roster, sessions, bulk mark, corrections, reports
│   │   │   ├── auth/               # Login, refresh, logout, /me
│   │   │   ├── cbc/                # CBC curriculum, assessments, PDF reports
│   │   │   ├── discipline/         # Incidents, student links, follow-ups, hard-delete
│   │   │   ├── enrollments/        # Student admission workflow + delete incomplete applications
│   │   │   ├── finance/            # Fee structures, invoices, payments
│   │   │   ├── igcse/              # IGCSE subjects, A*–G grade entry, report PDFs
│   │   │   ├── payments/           # Daraja M-Pesa + subscription billing
│   │   │   ├── public/             # Prospect registration & auth
│   │   │   ├── reports/            # 8-4-4 exam marks, report card PDF generation
│   │   │   ├── students/           # SIS: bio-data, guardians, emergency contacts, documents
│   │   │   └── support/            # Help desk ticketing
│   │   ├── core/
│   │   │   ├── audit.py            # Async audit log queue + worker
│   │   │   ├── config.py           # Pydantic settings (all env vars)
│   │   │   ├── database.py         # SQLAlchemy engine + session factory
│   │   │   ├── dependencies.py     # FastAPI Depends (auth, tenant, RBAC)
│   │   │   ├── middleware.py        # TenantMiddleware (request resolution)
│   │   │   ├── middleware_audit.py  # AuditMiddleware (HTTP context capture)
│   │   │   ├── middleware_request_id.py
│   │   │   ├── middleware_security.py
│   │   │   ├── rate_limit.py       # slowapi limiter (tenant-aware)
│   │   │   ├── redis.py            # Redis client (lazy connect)
│   │   │   └── session_cache.py    # Token blacklist + permission cache
│   │   ├── models/                 # SQLAlchemy ORM models (core schema)
│   │   │   ├── auth.py             # AuthSession
│   │   │   ├── audit_log.py        # AuditLog
│   │   │   ├── cbc.py              # CBC curriculum models (strands, sub-strands, learning outcomes, performance levels)
│   │   │   ├── enrollment.py       # Enrollment (with admission_year → student type detection)
│   │   │   ├── fee_catalog.py      # FeeCatalog (tenant item library)
│   │   │   ├── fee_structure.py    # FeeStructure, FeeStructureItem (per-term amounts, charge_frequency)
│   │   │   ├── finance_policy.py   # FinancePolicy
│   │   │   ├── invoice.py          # Invoice, InvoiceLine, Payment, PaymentAllocation (with term_number, academic_year, student_type)
│   │   │   ├── membership.py       # Membership (tenant ↔ user link)
│   │   │   ├── prospect.py         # ProspectAccount, ProspectRequest
│   │   │   ├── rbac.py             # Role, Permission, UserRole, Override
│   │   │   ├── student.py          # Student (with admission_year for NEW/RETURNING classification)
│   │   │   ├── subscription.py     # Subscription, SubscriptionPayment
│   │   │   ├── tenant.py           # Tenant
│   │   │   ├── tenant_payment_settings.py  # TenantPaymentSettings (per-tenant collection rules)
│   │   │   └── user.py             # User
│   │   ├── utils/
│   │   │   ├── cbc_report_pdf.py   # Pure-Python A4 CBC assessment report PDF
│   │   │   ├── fee_structure_pdf.py # Pure-Python A4 fee structure PDF
│   │   │   ├── invoice_pdf.py      # Pure-Python A4 invoice / receipt PDF
│   │   │   └── ...                 # hashing, tokens, helpers
│   │   └── main.py                 # FastAPI app factory, lifespan, router mount
│   ├── alambic/                    # Alembic migration versions (multiple branches: finance v2 + CBC)
│   ├── tests/                      # pytest test suite (381 tests)
│   │   ├── conftest.py             # Shared fixtures (DB, client, rate limiter)
│   │   ├── helpers.py              # create_tenant(), make_actor()
│   │   ├── test_admin_saas_endpoints.py  # SaaS tenant mgmt, subscriptions, RBAC
│   │   ├── test_attendance_phase2.py     # Roster, sessions, bulk mark, corrections, reports
│   │   ├── test_audit.py
│   │   ├── test_auth.py
│   │   ├── test_cbc_phase3b.py           # CBC curriculum + assessment report tests
│   │   ├── test_discipline_phase4.py     # Incidents, student links, follow-ups, hard-delete
│   │   ├── test_enrollments.py
│   │   ├── test_finance.py               # Finance v1 regression tests (updated for v2 schema)
│   │   ├── test_finance_v2.py            # Finance v2: charge frequency, per-term amounts, smart invoice engine
│   │   ├── test_payments.py
│   │   ├── test_public.py
│   │   ├── test_reports_phase3a.py       # 8-4-4 report card PDF generation
│   │   ├── test_security.py
│   │   ├── test_sis_phase0.py            # Curriculum type per tenant
│   │   ├── test_sis_phase1.py            # Bio-data, guardians, emergency contacts, documents
│   │   └── test_support.py
│   ├── Dockerfile
│   ├── gunicorn.conf.py
│   ├── requirements.txt
│   └── requirements-dev.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── (app)/
│   │   │   │   ├── saas/           # SaaS Admin portal pages
│   │   │   │   └── tenant/
│   │   │   │       ├── director/
│   │   │   │       │   ├── attendance/             # Director attendance pages
│   │   │   │       │   ├── cbc/                    # Director CBC module page
│   │   │   │       │   ├── discipline/             # Director discipline (incidents, new)
│   │   │   │       │   ├── finance/
│   │   │   │       │   │   └── payment-settings/   # Director payment settings page
│   │   │   │       │   ├── igcse/                  # Director IGCSE module page
│   │   │   │       │   ├── reports/                # Director 8-4-4 exam/report card pages
│   │   │   │       │   └── students/[enrollmentId] # Full student SIS profile + hard-delete
│   │   │   │       └── secretary/
│   │   │   │           ├── attendance/             # Secretary attendance pages
│   │   │   │           ├── cbc/                    # Secretary CBC module page
│   │   │   │           ├── discipline/             # Secretary discipline (incidents, new)
│   │   │   │           ├── finance/
│   │   │   │           │   └── payment-settings/   # Secretary payment settings page
│   │   │   │           └── students/[enrollmentId] # Student SIS profile view
│   │   │   └── api/
│   │   │       ├── auth/           # Next.js API routes (auth proxy)
│   │   │       └── tenant/
│   │   │           ├── director/finance/  # BFF proxy: finance actions + v2 invoice generation
│   │   │           └── secretary/finance/ # BFF proxy: finance actions + v2 invoice generation
│   │   ├── components/
│   │   │   ├── attendance/
│   │   │   │   └── AttendanceModulePage.tsx       # Shared attendance UI (director + secretary)
│   │   │   ├── cbc/
│   │   │   │   └── CbcModulePage.tsx              # Shared CBC module UI (director + secretary)
│   │   │   ├── discipline/
│   │   │   │   └── DisciplineModulePage.tsx       # Shared discipline UI (director + secretary)
│   │   │   ├── finance/
│   │   │   │   ├── FeeStructuresPage.tsx           # Fee structure management (v2)
│   │   │   │   ├── PaymentSettingsPage.tsx         # Tenant payment settings UI
│   │   │   │   └── finance-utils.ts               # Shared finance helpers
│   │   │   ├── igcse/
│   │   │   │   └── IgcseModulePage.tsx             # Shared IGCSE module UI (director + secretary)
│   │   │   ├── layout/                            # AppShell, navigation, sidebar, nav-config
│   │   │   ├── reports/
│   │   │   │   └── ReportsModulePage.tsx           # 8-4-4 exam/report card UI
│   │   │   ├── students/
│   │   │   │   └── StudentProfilePage.tsx          # Full SIS profile + discipline history + hard-delete
│   │   │   └── ui/                                # Reusable UI components
│   │   ├── i18n/                   # next-intl config + request handler
│   │   ├── lib/
│   │   │   ├── api.ts              # Typed API client
│   │   │   ├── auth/               # Cookies, JWT decode, RBAC helpers
│   │   │   └── format.ts           # KES formatting, date utilities
│   │   └── server/                 # Server-side data fetchers
│   ├── messages/                   # i18n translation files (en, sw)
│   ├── Dockerfile
│   ├── jest.config.ts
│   ├── next.config.ts
│   └── package.json
│
├── infra/
│   ├── backup/
│   │   ├── backup.sh               # pg_dump with daily/weekly/monthly rotation
│   │   └── restore.sh              # Restore from local or Cloudflare R2
│   ├── deploy/
│   │   └── staging.env.example     # Staging environment template
│   └── nginx/
│       ├── Dockerfile
│       └── nginx.conf.template     # Nginx config with envsubst placeholders
│
├── docker-compose.yml              # Local development stack
├── docker-compose.prod.yml         # Production stack (pre-built images)
└── README.md
```

---

## Testing

### Backend Tests

```bash
# Run inside Docker (recommended — uses the same postgres/redis as CI)
docker compose run --rm backend pytest -q tests/

# Run locally (requires postgres + redis running)
cd backend
pip install -r requirements-dev.txt
pytest -q tests/
```

The test suite covers **381 tests** across all modules:

| Module | File | Tests |
| --- | --- | --- |
| Auth (tenant + SaaS) | `test_auth.py` | Login, refresh, logout, token blacklisting, rate limits |
| Enrolments | `test_enrollments.py` | Create, submit, approve, reject, delete, permission gates |
| Finance v1 | `test_finance.py` | Fee structures, categories, items, policies, invoices, scholarships |
| Finance v2 | `test_finance_v2.py` | Charge frequency, per-term amounts, smart invoice engine, payment settings |
| SIS Phase 0 | `test_sis_phase0.py` | Curriculum type per tenant |
| SIS Phase 1 | `test_sis_phase1.py` | Bio-data, guardians, emergency contacts, documents (36 tests) |
| Attendance | `test_attendance_phase2.py` | Roster, sessions, bulk mark, corrections, reports (34 tests) |
| Report Cards | `test_reports_phase3a.py` | 8-4-4 report card PDF generation |
| CBC | `test_cbc_phase3b.py` | Strand/sub-strand CRUD, assessments, PDF reports |
| Discipline | `test_discipline_phase4.py` | Incidents, student links, follow-ups, hard-delete (25 tests) |
| Payments | `test_payments.py` | Daraja callback, subscription billing, rate limits |
| Public (prospect) | `test_public.py` | Registration, login, refresh, request CRUD |
| Support | `test_support.py` | Ticket creation, messaging, unread counts |
| Audit | `test_audit.py` | Log creation, retention pruning, payload sanitisation |
| Security | `test_security.py` | CORS, headers, injection guards, session integrity |
| SaaS Admin | `test_admin_saas_endpoints.py` | Tenant mgmt, subscriptions, RBAC |

### Frontend Tests

```bash
# Run inside Docker
docker compose run --rm frontend npx jest --no-coverage

# Run locally
cd frontend
npm ci
npx tsc --noEmit          # type check
npx jest --no-coverage    # unit tests
npm run build             # full production build
```

---

## CI/CD Pipeline

```
Push / PR to main or staging
        │
        ├─► backend-tests ──────────────────────────────────────────┐
        │   Python 3.12                                              │
        │   Real PostgreSQL 16.4 + Redis 7.4 services               │
        │   pytest -q tests/                                         │
        │                                                            ▼
        ├─► frontend-checks ──────────────────────────── docker-images (push only)
        │   Node 22                                       Build backend, frontend,
        │   tsc --noEmit                                  nginx images
        │   jest --no-coverage --ci                       Tag: sha-{7char}, branch,
        │   npm run build                                 latest / staging-latest
        │                                                            │
        │                                                  ┌─────────┴──────────┐
        │                                                  │                    │
        │                                            deploy-staging       deploy-production
        │                                            (push to staging)    (push to main)
        │                                            Copies compose file  Copies compose file
        │                                            SSHes to droplet     SSHes to droplet
        │                                            docker compose up    docker compose up
        │                                            Smoke test nginx     Smoke test nginx
```

**Image naming convention:**

```
ghcr.io/manlikeganga19-tech/school-management-system-backend:sha-a1b2c3d
ghcr.io/manlikeganga19-tech/school-management-system-frontend:staging-latest
ghcr.io/manlikeganga19-tech/school-management-system-nginx:latest
```

**GitHub Environment secrets required:**

| Secret | Environment | Description |
|---|---|---|
| `STAGING_SSH_HOST` | staging | Droplet IP |
| `STAGING_SSH_USER` | staging | SSH username |
| `STAGING_SSH_PRIVATE_KEY` | staging | Private key (PEM) |
| `STAGING_DEPLOY_PATH` | staging | Deploy dir on droplet (e.g. `/opt/sms-staging`) |
| `STAGING_ENV_FILE` | staging | Full contents of production `.env` |
| `GHCR_TOKEN` | staging | PAT with `read:packages` |
| `GHCR_USERNAME` | staging | GitHub username for GHCR login |
| `PRODUCTION_SSH_HOST` | production | Droplet IP |
| `PRODUCTION_SSH_USER` | production | SSH username |
| `PRODUCTION_SSH_PRIVATE_KEY` | production | Private key (PEM) |
| `PRODUCTION_DEPLOY_PATH` | production | Deploy dir on droplet |
| `PRODUCTION_ENV_FILE` | production | Full contents of production `.env` |
| `GHCR_TOKEN` | production | PAT with `read:packages` |
| `GHCR_USERNAME` | production | GitHub username |

---

## Deployment

### Staging

Deployments to staging happen automatically on every push to the `staging` branch once all tests pass.

**Staging URL:** https://staging.shulehq.co.ke

**Manual deploy (emergency):**

```bash
ssh user@<staging-droplet-ip>
cd /opt/sms-staging
IMAGE_TAG=<sha> docker compose -f docker-compose.prod.yml --env-file .env up -d
```

### Production

Production deployments are gated by a **required reviewer approval** on the `production` GitHub Environment. The workflow triggers on push to `main`.

**Production URL:** https://shulehq.co.ke

**Deployment flow:**
1. Merge PR into `main`
2. GitHub Actions builds and pushes images
3. Deploy job waits for manual approval
4. Approved → SSH to production droplet → pull images → `docker compose up -d` → smoke test

**Rollback:**

```bash
# Identify the last known-good tag
docker images | grep school-management-system-backend

# Roll back to previous tag
IMAGE_TAG=<previous-sha> docker compose -f docker-compose.prod.yml --env-file .env up -d
```

### Server Setup (first time, per droplet)

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

# 2. Install Caddy (TLS proxy)
apt install -y caddy

# 3. Create deploy directory
mkdir -p /opt/sms-staging       # or /opt/sms-production

# 4. Configure Caddy (example)
# /etc/caddy/Caddyfile
# staging.shulehq.co.ke {
#   reverse_proxy localhost:8081
# }

# 5. Configure automated backups
cp infra/backup/backup.sh /opt/sms-staging/backup.sh
chmod +x /opt/sms-staging/backup.sh
crontab -e
# Add: 0 2 * * * /opt/sms-staging/backup.sh >> /var/log/sms-backup.log 2>&1
```

---

## Security

### Authentication

- **JWT access tokens** (15-minute TTL) signed with `JWT_SECRET`
- **Refresh tokens** stored as HttpOnly, Secure, SameSite=Lax cookies (30-day TTL)
- **Argon2id** password hashing via passlib
- **Token blacklist** — access tokens are invalidated in Redis on logout (sub-millisecond checks)
- **Permission cache** — resolved permissions cached in Redis for 15 minutes per user session

### Rate Limiting

All endpoints are rate-limited via `slowapi` backed by Redis:

| Endpoint | Limit | Key |
|---|---|---|
| `POST /auth/login` | 5/minute | per IP |
| `POST /auth/login/saas` | 5/minute | per IP |
| `POST /public/auth/register` | 10/minute | per IP |
| `POST /public/auth/login` | 10/minute | per IP |
| `POST /payments/daraja/callback` | 30/minute | per IP |
| All other endpoints | 2000/minute | per tenant UUID |

### Authorisation (RBAC)

```
Permission (code: "finance.policy.manage")
    │
Role (DIRECTOR) ←──── UserRole (user_id, tenant_id, role_id)
    │
UserPermissionOverride (ALLOW / DENY per user, per permission)
```

Every protected endpoint declares its required permission via `require_permission("permission.code")`. The resolved permission set is JWT-embedded for speed and Redis-cached as a fallback.

### Data Isolation

- Every database query in tenant-scoped endpoints includes `WHERE tenant_id = :tenant_id`
- Tenant ID is resolved from the JWT payload (set at login), not the request body
- The `core` PostgreSQL schema is separate from the `public` schema — no cross-tenant table access by design

### Network Security (Nginx)

All responses include:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()
Content-Security-Policy: default-src 'self'; ...
```

### Secrets

| Secret | Where it lives | Notes |
|---|---|---|
| `JWT_SECRET` | Backend env only | Never logged |
| `REDIS_PASSWORD` | Backend env, injected at runtime | Separate from `REDIS_URL` to avoid log exposure |
| `DARAJA_CONSUMER_SECRET` | Backend env only | Never sent to frontend |
| `DARAJA_CALLBACK_TOKEN` | Backend env + Safaricom dashboard | Validated on every callback |
| SSH private keys | GitHub Environment secrets | Never in code |
| `.env` files | GitHub Environment secrets | Never committed |

---

## M-Pesa / Daraja Integration

ShuleHQ uses the **Safaricom Daraja API** for subscription billing via M-Pesa STK Push.

### Payment Flow

```
1. Director clicks "Pay Subscription" → enters phone number + confirms amount
2. Frontend → POST /api/v1/payments/subscription/pay
3. Backend validates phone (Kenyan format), checks dedup window (5 min)
4. Backend → Daraja /oauth → AccessToken
5. Backend → Daraja /stkpush → STK Push sent to user's phone
6. Backend stores SubscriptionPayment (status: PENDING)
7. Frontend polls GET /payments/subscription/payment-status?checkout_request_id=XXX
8. User enters M-Pesa PIN on phone
9. Safaricom → POST /api/v1/payments/daraja/callback (async, ~10-30s)
10. Backend validates DARAJA_CALLBACK_TOKEN, updates payment (COMPLETED/FAILED)
11. Frontend polling detects COMPLETED → shows receipt
```

### Configuration

| Setting | Sandbox | Production |
|---|---|---|
| `DARAJA_ENV` | `sandbox` | `production` |
| `DARAJA_CONSUMER_KEY` | Safaricom developer portal | Safaricom Go-Live credentials |
| `DARAJA_SHORTCODE` | `174379` (test) | Your paybill/till |
| `DARAJA_PASSKEY` | Test passkey | Live passkey |
| `DARAJA_CALLBACK_BASE_URL` | ngrok or staging URL | `https://shulehq.co.ke` |

### Mock Mode

For local development and CI, set `DARAJA_USE_MOCK=true`. The mock provider returns a successful payment immediately, skipping all Safaricom calls.

---

## Backup & Recovery

### Automated Backups

Backups run daily at 02:00 UTC via cron on the production droplet:

```
/var/backups/sms/
├── daily/
│   ├── school_manager_db_2026-03-23.sql.gz
│   └── ...  (7 days retained)
├── weekly/
│   └── ...  (4 weeks retained)
└── monthly/
    └── ...  (3 months retained)
```

Backups are also uploaded to **Cloudflare R2** (S3-compatible, free tier) for offsite storage.

### Running a Manual Backup

```bash
/opt/sms-production/backup.sh
```

### Restoring

```bash
# From local file
./infra/backup/restore.sh /var/backups/sms/daily/school_manager_db_2026-03-23.sql.gz

# From Cloudflare R2
./infra/backup/restore.sh r2://sms-backups/daily/school_manager_db_2026-03-23.sql.gz
```

> **Warning:** Restore drops and recreates the `core` schema. Always confirm the target server before running.

---

## Development Roadmap

| Phase | Module | Status | Highlights |
|---|---|---|---|
| **Phase 0** | SaaS Foundation | **Complete** | Multi-tenant core, RBAC, JWT auth, audit log, rate limiting, M-Pesa billing, CI/CD |
| **Phase 1** | SIS — Student Information System | **Complete** | Bio-data, guardians, emergency contacts, document uploads, curriculum type per tenant |
| **Phase 2** | Attendance | **Complete** | Class roster, session lifecycle (DRAFT → SUBMITTED → FINALIZED), bulk mark, corrections, PDF reports |
| **Phase 3a** | 8-4-4 Report Cards | **Complete** | Exam setup, timetable, mark entry, A4 report card PDF generation |
| **Phase 3b** | CBC Module | **Complete** | Strand/sub-strand/learning outcome management, performance level assessments, progress report PDFs |
| **Phase 3c** | IGCSE Module | **Complete** | Subject management, A*–G grade entry, individual and bulk class report PDFs, curriculum-gated nav |
| **Phase 4** | Discipline + Student Hard-Delete | **Complete** | Incident logging, student links (PERPETRATOR/VICTIM/WITNESS), follow-up notes; permanent student removal with full finance/audit cleanup; delete incomplete applications |
| **Phase 5** | Communications | Planned | SMS/email notifications (Twilio/Africa's Talking), parent messaging, announcement broadcasts |
| **Phase 6** | Parent Portal | Planned | Self-service portal: view invoices, pay fees via M-Pesa, view report cards, attendance summaries |
| **Phase 7** | Transport Module | Planned | Route management, vehicle assignment, driver profiles, morning/evening attendance |
| **Phase 8** | Timetable / Scheduling | Planned | Class timetable builder, teacher assignment, conflict detection |
| **Phase 9** | Staff & HR | Planned | Staff profiles, leave management, payroll integration hooks |

> Completed phases are live on production. Planned phases are prioritised by school demand.

---

## Contributing

This is a private repository. Contributions are by invitation only.

**Branch strategy:**

| Branch | Purpose |
|---|---|
| `main` | Production-ready code. Protected — PRs only. |
| `staging` | Staging integration branch. Deploys automatically. |
| `feature/*` | Feature development. PR into `staging`. |
| `fix/*` | Bug fixes. PR into `staging`. |

**Commit convention:** `type(scope): message`

```
feat(finance): add partial-payment enforcement policy
fix(auth): stabilise tenant refresh session state
chore(ci): align secret names with environment configuration
```

**Before raising a PR:**

```bash
# Backend
cd backend && pytest -q tests/

# Frontend
cd frontend && npx tsc --noEmit && npx jest --no-coverage && npm run build
```

All CI checks must pass before a PR can be merged.

---

<p align="center">
  Built for Kenyan schools &mdash; <strong>ShuleHQ</strong> &copy; 2026
</p>
