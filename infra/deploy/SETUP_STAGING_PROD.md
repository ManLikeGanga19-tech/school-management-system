# infra/deploy/SETUP_STAGING_PROD.md

# Staging + Production Setup Checklist (shulehq.co.ke)

Use this document to complete:
1. GitHub Secrets
2. Branch strategy (`staging` + `main`)
3. GitHub Environments and approvals
4. Domain and DNS pointing
5. First staging deployment validation

## 1) Create `staging` branch and push

From repository root:

```bash
git checkout -b staging
git push -u origin staging
git checkout main
```

## 1.1) Confirm if staging and production are the same server

Primary check:
- Compare values of GitHub secrets:
  - `STAGING_SSH_HOST`
  - `PRODUCTION_SSH_HOST`
- If they are identical (same IP/FQDN), they are the same server target.

If hostnames differ, resolve both:

```bash
dig +short <staging-hostname>
dig +short <production-hostname>
```

Hard verification using machine ID:

```bash
ssh <staging_user>@<staging_host> "hostname; cat /etc/machine-id"
ssh <prod_user>@<prod_host> "hostname; cat /etc/machine-id"
```

If `/etc/machine-id` is the same, both environments are on the same server.

## 2) Configure GitHub Environments

In GitHub repo: `Settings` -> `Environments`

Create:
- `staging`
- `production`

Recommended protection:
- `staging`:
  - Optional reviewer gate
  - Optional deployment branch policy: `staging`
- `production`:
  - Required reviewers: at least 1
  - Wait timer: 5 minutes (optional)
  - Deployment branch policy: `main` only

## 3) Add repository secrets

In GitHub repo: `Settings` -> `Secrets and variables` -> `Actions`

Add shared secrets:
- `GHCR_USERNAME`
- `GHCR_TOKEN`

Add staging secrets:
- `STAGING_SSH_HOST`
- `STAGING_SSH_USER`
- `STAGING_SSH_PRIVATE_KEY`
- `STAGING_DEPLOY_PATH` (example: `/opt/school-erp-staging`)
- `STAGING_ENV_FILE` (paste full `.env` content for staging)

Add production secrets:
- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_DEPLOY_PATH` (example: `/opt/school-erp-production`)
- `PRODUCTION_ENV_FILE` (paste full `.env` content for production)

Use these templates when preparing env content:
- `infra/deploy/staging.env.example`
- `infra/deploy/production.env.example`

## 4) Domain DNS setup (Registrar / DNS provider)

Current domains:
- Production: `shulehq.co.ke`
- Staging: `staging.shulehq.co.ke`

Create records:
- `A` record:
  - Host: `@`
  - Value: `<PRODUCTION_SERVER_PUBLIC_IP>`
  - TTL: `300`
- `A` record:
  - Host: `staging`
  - Value: `<STAGING_SERVER_PUBLIC_IP>`
  - TTL: `300`
- Optional `CNAME`:
  - Host: `www`
  - Value: `shulehq.co.ke`

If staging and production are on the same VM:
- keep both compose nginx listeners on loopback only
- assign different loopback ports, for example:
  - staging `NGINX_HTTP_PORT=127.0.0.1:8081`
  - production `NGINX_HTTP_PORT=127.0.0.1:8082`
- use a host reverse proxy (recommended: Caddy) to route:
  - `staging.shulehq.co.ke` -> `127.0.0.1:8081`
  - `shulehq.co.ke` -> `127.0.0.1:8082`

If staging and production are on separate VMs:
- standardize each environment on `NGINX_HTTP_PORT=127.0.0.1:8081`
- terminate TLS on the host and reverse proxy to that loopback listener

Verify DNS:

```bash
dig +short shulehq.co.ke
dig +short staging.shulehq.co.ke
```

## 5) Server prerequisites (staging + production)

On each server:
- Docker Engine + Docker Compose plugin installed
- SSH user can run docker commands
- Firewall open: `80` and `443`
- If using UFW:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Note:
- For staging/production env files, bind backend/frontend/postgres/redis to `127.0.0.1:*`
  so they are not publicly reachable.
- Keep compose nginx bound to loopback only.
- Let the host TLS proxy own public `80` and `443`.

## 6) TLS for domains (required before live traffic)

Recommended architecture:

1. Install Caddy on the host
2. Keep compose nginx private on loopback
3. Reverse proxy public traffic through Caddy to the app edge

Example Caddyfiles:
- `infra/deploy/caddy/staging.Caddyfile.example`
- `infra/deploy/caddy/production.Caddyfile.example`

Minimal flow:

```bash
ssh root@<staging_host> "apt-get update && apt-get install -y caddy"
scp infra/deploy/caddy/staging.Caddyfile.example root@<staging_host>:/etc/caddy/Caddyfile
ssh root@<staging_host> "caddy validate --config /etc/caddy/Caddyfile && systemctl restart caddy"
```

Runtime expectations:
- Caddy listens on `0.0.0.0:80` and `0.0.0.0:443`
- compose nginx listens on `127.0.0.1:8081`
- `COOKIE_SECURE=true` in the environment file after TLS is active

Minimum TLS check after setup:

```bash
curl -I https://shulehq.co.ke
curl -I https://staging.shulehq.co.ke
```

## 7) Trigger first staging deployment

Option A: push to `staging` branch:

```bash
git checkout staging
git add .
git commit -m "chore: setup staging/prod deployment pipeline"
git push
```

Option B: manually run workflow:
- GitHub -> `Actions` -> `Deploy Staging` -> `Run workflow`

## 8) Validate staging after deployment

Checks:
- Workflow succeeded (CI + Deploy Staging)
- Host app up:
  - `https://staging.shulehq.co.ke/nginx-healthz` -> `ok`
- UI loads:
  - `https://staging.shulehq.co.ke` (after TLS)
- API health:
  - `https://staging.shulehq.co.ke/api/v1/...` route responds

Rollback (if needed):
- Actions -> `Deploy Staging` -> `Run workflow`
- Set `image_tag` to previously working short SHA

## 9) Production rollout

After staging validation:
1. Merge `staging` -> `main`
2. CI builds main images
3. `Deploy Production` runs (approval required from environment rule)
4. Validate `https://shulehq.co.ke`
