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
