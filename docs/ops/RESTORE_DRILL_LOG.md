# ShuleHQ — Restore Drill Log

Every restore drill (Backup & Restore Runbook §7) is recorded here with its
outcome. A drill proves the backup is *recoverable*, not merely that it exists.

---

## Drill #1 — initial proof (dev environment)

| Field | Value |
|---|---|
| **Environment** | dev (`school_manager_db`, PostgreSQL 16.4) |
| **Method** | `pg_dump -Fc --no-owner --no-privileges` → restore into scratch DB `shulehq_restore_drill` via `pg_restore --clean --if-exists --no-owner` (identical commands to `backup_service`) |
| **Artifact SHA-256** | `0d836ba2cb05d44ddece3eed484c8ff5b816e3fc6b66b1e334c416a141550cb1` |
| **Dump size** | 371,618 bytes |
| **Outcome** | ✅ **PASS** |

### Acceptance checklist
- [x] `pg_restore` completed — **0 hard errors**
- [x] Row-count sanity (source vs restored) — **all match**:
      tenants 5 · users 16 · students 39 · enrollments 39 · invoices 68 ·
      payments 42 · attendance_records 240 · scholarships 0 · backups 0
- [x] Alembic head matches — `bkp1a2b3c4d5` on both
- [x] **Login survives restore** — `director@demo.shulehq.co.ke` password
      (`Demo@2026`) verified against the hash read *from the restored DB*
      using the app's own `verify_password` → **True**
- [x] Media archive mechanism valid (0 files in dev; empty archive opens
      cleanly — mechanism proven, will carry files in prod)
- [x] Scratch DB dropped, temp files removed

### Conclusion
The backup → restore round trip is proven recoverable: schema, all business
data, migration state, and working credentials all survive intact. The
backup feature is cleared for production reliance.

> **Next required drills:**
> - Drill #2: **against production data** immediately after the Contabo cutover
>   (restore the real production backup into a scratch DB on the VPS).
> - Then **monthly** thereafter, per the runbook.

---

## Drill #2 — production data restored onto the Contabo VPS (Phase 3b rehearsal)

Performed as the migration dress rehearsal: the real production backup taken
from the admin dashboard was restored onto the target VPS and exercised
end-to-end, while Render continued to serve live traffic untouched.

| Field | Value |
|---|---|
| **Source** | production `school_manager_db_2e09` on Render (PostgreSQL 18.4) |
| **Target** | Contabo VPS `sms-postgres` (PostgreSQL 18.4), database `shulehq` |
| **Artifact** | `shulehq-backup-1784785716572.tar`, taken 2026-07-23 05:48:34 UTC |
| **Artifact SHA-256** | `a20c38fde55d7dd6642a8d59a24a1ac08c7000a35d33cf22f1104752b25d9a5f` |
| **Dump SHA-256** | `cc8cbe8e5e732fa05786b7fe1d5d4f54af903e799a6d1021cc13348158772fc8` (1,021,361 bytes) |
| **Method** | drop/recreate target DB → `pg_restore --no-owner --no-privileges` → `alembic upgrade heads` |
| **Outcome** | ✅ **PASS** |

### Acceptance checklist
- [x] Artifact SHA-256 identical at source, after transfer to the VPS, and in
      the dashboard ledger — integrity proven at every hop
- [x] Dump SHA-256 matches `manifest.json`
- [x] Version compatibility exact — 18.4 dump / 18.4 server / 18.4 `pg_restore`
- [x] `pg_restore` completed — **exit 0, zero errors**
- [x] Object counts match — 87 `core` tables + 1 `public` (`alembic_version`) = 88,
      equal to the manifest's `table_data_count`
- [x] **Row counts reconciled across all 87 tables**: 86 identical; the single
      difference (`student_emergency_contacts` 371 vs 368) was proven to be
      live drift — exactly 3 rows created on Render *after* the backup
      timestamp, confirmed by `created_at`. Not data loss.
- [x] Migration applied to restored data: `bkp1a2b3c4d5` → `bkp2widen1a2b`
      (the cutover migration step, rehearsed)
- [x] Backend healthy against restored data (`/readyz` → `{"status":"ready"}`)
- [x] Auth chain verified over real HTTPS — wrong password returns `401`
      (not `500`) on both tenant subdomains, proving
      Caddy → nginx → backend → tenant resolution → argon2
- [x] **Real interactive login succeeded** over the wildcard certificate with
      genuine credentials, and the school's live data rendered correctly
- [x] Wildcard cert `*.shulehq.co.ke` issued by Let's Encrypt **production**
      via Cloudflare DNS-01

### Measured RPO signal
The 3-row drift over ~3.5 hours quantifies real production write volume.
Small but non-zero: **the cutover's final backup must be taken inside the
maintenance window**, since anything written to Render between the final dump
and the DNS flip never reaches Contabo.

### Conclusion
The full migration path — backup → transfer → restore → migrate → serve → log
in — is proven against real production data on the real target infrastructure.
Cleared for cutover.
