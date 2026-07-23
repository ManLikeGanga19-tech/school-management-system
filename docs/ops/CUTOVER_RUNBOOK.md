# ShuleHQ — Render/Vercel → Contabo Cutover Runbook (Phase 4)

> Executed only after Restore Drill #2 passed (see `RESTORE_DRILL_LOG.md`).
> The rehearsal proved backup → transfer → restore → migrate → serve → login
> against real production data on the real target. This runbook performs the
> same steps for real, inside a maintenance window, and flips DNS.

**Target VPS:** `94.72.102.13` · **Deploy path:** `/opt/shulehq`

---

## 0. Why there must be a maintenance window

Drill #2 measured real drift: **3 rows written to Render in ~3.5 hours**.
Anything written to Render *after* the final backup and *before* the DNS flip
is data that never reaches Contabo — silently. The only way to guarantee zero
loss is to **stop writes before taking the final backup**.

Expected downtime: **5–10 minutes**.

Pick a genuinely low-traffic window (schools are active during school hours —
prefer evening or weekend).

---

## 1. Pre-cutover checklist (do these BEFORE the window)

- [ ] VPS running the latest `main` deploy, all services healthy
- [ ] `deploy/.env.production` and the `PRODUCTION_ENV_FILE` secret are in sync
- [ ] Daraja sandbox `DARAJA_CONSUMER_KEY` / `DARAJA_CONSUMER_SECRET` filled,
      **or** accept `DARAJA_SANDBOX_FALLBACK_TO_MOCK=true` (payments mock)
- [ ] A fresh dashboard backup downloaded and stored on **two** external drives
- [ ] This runbook open, plus the rollback table in §5

### DNS rollback reference — CURRENT state, captured 2026-07-23

**If anything goes wrong, restore exactly these.** All were **proxied (orange)**,
TTL auto.

| Type | Name | Content | Proxied |
|---|---|---|---|
| A | `*.shulehq.co.ke` | `216.198.79.65` | yes |
| A | `*.shulehq.co.ke` | `64.29.17.1` | yes |
| A | `shulehq.co.ke` | `64.29.17.1` | yes |
| A | `shulehq.co.ke` | `64.29.17.65` | yes |
| A | `www.shulehq.co.ke` | `64.29.17.1` | yes |
| A | `www.shulehq.co.ke` | `216.198.79.1` | yes |
| CNAME | `api.shulehq.co.ke` | `shulehq-backend.onrender.com` | yes |
| CNAME | `_domainconnect.shulehq.co.ke` | `_domainconnect.vercel-dns.com` | yes |
| CAA | `shulehq.co.ke` | `0 issue "sectigo.com"` | n/a |
| CAA | `shulehq.co.ke` | `0 issue "pki.goog"` | n/a |
| CAA | `shulehq.co.ke` | `0 issue "letsencrypt.org"` | n/a |

> **Never delete the `letsencrypt.org` CAA record** — it authorises the CA that
> issues the wildcard certificate. Removing it breaks renewals.

---

## 2. Cutover sequence

### 2.1 Stop writes to production
Suspend the Render **backend** web service. The app becomes unavailable — this
is the maintenance window, and it is what guarantees no lost writes.

### 2.2 Take the FINAL backup
From the admin dashboard (**Backups → Create & Download**) *or*, if the app is
already suspended, directly:

```bash
pg_dump -Fc --no-owner --no-privileges \
  "host=dpg-d82qjv03kofs73d32ckg-a.oregon-postgres.render.com port=5432 \
   dbname=school_manager_db_2e09 user=shulehq sslmode=require" \
  -f final-cutover.dump
```
Record its SHA-256. **Archive it before proceeding** — this is the rollback
artifact of record.

### 2.3 Restore onto the VPS
Identical to Drill #2 (proven procedure):

```bash
scp -i ~/.ssh/shulehq_admin_key final-cutover.dump deploy@94.72.102.13:/opt/shulehq/
ssh -i ~/.ssh/shulehq_admin_key deploy@94.72.102.13
cd /opt/shulehq
sha256sum final-cutover.dump                      # must match §2.2
docker compose --env-file .env -f docker-compose.prod.yml stop backend
docker cp final-cutover.dump sms-postgres:/tmp/f.dump
docker exec -u postgres sms-postgres psql -U shulehq -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS shulehq;" -c "CREATE DATABASE shulehq OWNER shulehq;"
docker exec -u postgres sms-postgres pg_restore -U shulehq -d shulehq \
  --no-owner --no-privileges /tmp/f.dump
docker compose --env-file .env -f docker-compose.prod.yml run --rm --no-deps db-migrate
docker compose --env-file .env -f docker-compose.prod.yml up -d backend
docker exec sms-postgres rm -f /tmp/f.dump && rm -f final-cutover.dump
```

### 2.4 Verify BEFORE touching DNS
Using the browser-override trick (no system changes):

```
chrome.exe --host-resolver-rules="MAP shulehq.co.ke 94.72.102.13,MAP *.shulehq.co.ke 94.72.102.13" --user-data-dir="%TEMP%\shulehq-cut" https://novel-school.shulehq.co.ke
```
- [ ] Login succeeds
- [ ] Latest data present (including records written just before the window)
- [ ] Row counts reconcile against the Render source

**Do not flip DNS until this passes.**

### 2.5 Flip DNS (Cloudflare)
Set **all** of these to `94.72.102.13`, **Proxy status: DNS only (grey cloud)**,
**TTL 60 s** (fast rollback):

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `shulehq.co.ke` | `94.72.102.13` | DNS only |
| A | `www` | `94.72.102.13` | DNS only |
| A | `*` | `94.72.102.13` | DNS only |
| A | `api` | `94.72.102.13` | DNS only |

Delete the duplicate Vercel A records and **replace the `api` CNAME with an A
record**. Leave the CAA records untouched.

> **Grey cloud is required**: Caddy terminates TLS with the Let's Encrypt
> wildcard. Proxying would put Cloudflare's certificate in front and demands
> SSL mode "Full (strict)"; a mismatch causes redirect loops. Cloudflare proxy
> can be reconsidered as hardening *after* burn-in.

### 2.6 Verify from the outside
```bash
dig +short A novel-school.shulehq.co.ke      # -> 94.72.102.13
curl -sI https://novel-school.shulehq.co.ke | head -3
```
- [ ] Resolves to the VPS from a network you do not control (phone on mobile data)
- [ ] Padlock valid, login works, data correct
- [ ] `api.shulehq.co.ke` serving

### 2.7 Resume
Leave the Render service **suspended but NOT deleted** — it is the rollback path.

---

## 3. Post-cutover (first 24–48 h burn-in)

- [ ] Watch `docker compose logs -f backend` for errors
- [ ] Confirm a real tenant action end-to-end (create an invoice, record a payment)
- [ ] Take a dashboard backup **from the VPS** and verify its SHA-256
- [ ] Check memory/disk headroom: `free -h`, `df -h`
- [ ] Confirm certificate auto-renewal is scheduled (Caddy handles it; cert
      expires Oct 21 2026)

---

## 4. Deferred items (post-cutover, tracked)

- Automated nightly backup + offsite push (`BACKUP_ENCRYPTION_KEY`,
  `BACKUP_OFFSITE_RCLONE_REMOTE`) — **do this before decommissioning Render**
- Remove the hardcoded dev fallback in `_expected_public_oauth_secret()`
- Align dev Postgres (16) with production (18)
- Make the backup e2e test fail loudly in CI rather than skip
- Rotate credentials exposed during migration (Render DB password, `SECRET_KEY`)

---

## 5. Rollback

**Trigger:** login broken, data wrong/missing, or sustained 5xx after the flip.

1. Restore the DNS records exactly as in §1 (Vercel IPs + Render CNAME,
   proxied). With TTL 60 s, propagation is ~1 minute.
2. Un-suspend the Render backend service.
3. Verify production is serving again from Render.
4. Post-mortem before re-attempting.

**Rollback stays viable because Render is untouched and still holds its data.**
Do not decommission Render until burn-in has passed *and* automated backups run
on the VPS.
