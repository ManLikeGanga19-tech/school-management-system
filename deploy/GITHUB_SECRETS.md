# ShuleHQ — GitHub Secrets for Contabo deployment

`deploy-production.yml` already SSHes to a VPS and runs the prod compose.
**Retargeting Contabo is only setting these secrets** — no workflow code
change. Set them under **Settings → Environments → `production` → Secrets**
(the workflow uses `environment: production`).

| Secret | Value | Notes |
|---|---|---|
| `PRODUCTION_SSH_HOST` | Contabo VPS IPv4 | from your VPS panel |
| `PRODUCTION_SSH_USER` | `deploy` | the non-root user `provision.sh` creates |
| `PRODUCTION_SSH_PRIVATE_KEY` | private half of the CI SSH key | its public half goes in `provision.sh` `CI_PUBLIC_KEY`. OpenSSH format. |
| `PRODUCTION_DEPLOY_PATH` | `/opt/shulehq` | matches `provision.sh` |
| `PRODUCTION_ENV_FILE` | the entire filled `deploy/.env.production.example` | pasted verbatim; the workflow composes the live `.env` from it |
| `GHCR_USERNAME` | your GitHub username | to pull images (or the workflow uses `github.token`) |
| `GHCR_TOKEN` | a PAT with `read:packages` | only if `github.token` can't pull |

## Generate the CI SSH key (locally)

```bash
ssh-keygen -t ed25519 -C "ci@shulehq" -f shulehq_ci_key
#  shulehq_ci_key       → paste into secret PRODUCTION_SSH_PRIVATE_KEY
#  shulehq_ci_key.pub   → paste into provision.sh CONFIG (CI_PUBLIC_KEY)
```

## Order of operations

1. `provision.sh` on the VPS (with `CI_PUBLIC_KEY` set).
2. Set the secrets above.
3. Create DNS A records → VPS IP: `shulehq.co.ke`, `www`, `api`, `admin`,
   each marketing domain, and **`*.shulehq.co.ke`** (tenant subdomains).
4. **Dress rehearsal** (Phase 3): deploy, restore a COPY of prod data, run
   smoke tests — production still on Render.
5. **Cutover** (Phase 4): final backup → restore → flip DNS → re-point
   Daraja/SMS callbacks → Restore Drill #2 → burn-in → decommission Render.

## Pre-cutover integration checklist (don't skip)

- [ ] `DARAJA_CALLBACK_BASE_URL=https://api.shulehq.co.ke` and the callback
      URL **re-registered with Safaricom**.
- [ ] Africa's Talking: VPS IP allowlisted (if AT enforces it).
- [ ] `JWT_SECRET` carried over **verbatim** from the current prod (or every
      session is invalidated at cutover).
- [ ] `NEXT_PUBLIC_API_BASE_URL=https://api.shulehq.co.ke/api/v1` (build-time).
