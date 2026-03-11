# infra/deploy/README.md

# Staging + Production Deployment Runbook

This project deploys from GitHub Actions to two Docker hosts over SSH:
- `staging.shulehq.co.ke` (staging)
- `shulehq.co.ke` (production)

Images are built in CI and pushed to GHCR:
- `ghcr.io/manlikeganga19-tech/school-management-system-backend`
- `ghcr.io/manlikeganga19-tech/school-management-system-frontend`
- `ghcr.io/manlikeganga19-tech/school-management-system-nginx`

Deployments are commit-pinned using a short SHA tag (example: `a1b2c3d`).

## GitHub Workflows

- `.github/workflows/ci.yml`
  - Runs backend tests and frontend build checks.
  - Builds and pushes backend/frontend/nginx images on `push` to `main` or `staging`.
- `.github/workflows/deploy-staging.yml`
  - Auto-deploys after CI succeeds on `staging`.
  - Supports manual rollback via `workflow_dispatch` + `image_tag`.
- `.github/workflows/deploy-production.yml`
  - Auto-deploys after CI succeeds on `main`.
  - Supports manual rollback via `workflow_dispatch` + `image_tag`.

## Required GitHub Secrets

Shared:
- `GHCR_USERNAME`
- `GHCR_TOKEN` (PAT with `read:packages`; `write:packages` if needed from host)

Staging:
- `STAGING_SSH_HOST`
- `STAGING_SSH_USER`
- `STAGING_SSH_PRIVATE_KEY`
- `STAGING_DEPLOY_PATH` (optional; defaults to `/opt/school-erp-staging`)
- `STAGING_ENV_FILE` (full runtime `.env` content)

Production:
- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_DEPLOY_PATH` (optional; defaults to `/opt/school-erp-production`)
- `PRODUCTION_ENV_FILE` (full runtime `.env` content)

## Runtime Env Content

Use these templates:
- `infra/deploy/staging.env.example`
- `infra/deploy/production.env.example`
- `infra/deploy/caddy/staging.Caddyfile.example`
- `infra/deploy/caddy/production.Caddyfile.example`
- End-to-end setup checklist:
  - `infra/deploy/SETUP_STAGING_PROD.md`

The deploy workflows append image pinning and domain values automatically:
- `APP_ENV`
- `PROD_DOMAIN`
- `IMAGE_TAG`
- `BACKEND_IMAGE`
- `FRONTEND_IMAGE`
- `NGINX_IMAGE`

## First-Time Host Setup

1. Install Docker Engine + Docker Compose plugin on staging and production hosts.
2. Ensure SSH user can run `docker` without sudo.
3. Open firewall ports:
   - `80` and `443` public
   - block direct DB/Redis public access unless intentionally exposed
4. Configure DNS:
   - `staging.shulehq.co.ke` -> staging host IP
   - `shulehq.co.ke` -> production host IP
5. Configure host-level TLS termination.
   - Recommended: `Caddy` on the host.
   - Bind compose nginx to loopback only with `NGINX_HTTP_PORT=127.0.0.1:8081`.
   - Reverse proxy:
     - `staging.shulehq.co.ke` -> `127.0.0.1:8081`
     - `shulehq.co.ke` -> `127.0.0.1:8081` on the production host
   - If staging and production share one host, assign distinct loopback ports
     such as `127.0.0.1:8081` and `127.0.0.1:8082`.
6. Keep `COOKIE_SECURE=true` anywhere TLS is active.

## Rollback

Use manual dispatch for deploy workflow and set `image_tag` to a known good short SHA.
That redeploys all three services to the chosen immutable image tag.
