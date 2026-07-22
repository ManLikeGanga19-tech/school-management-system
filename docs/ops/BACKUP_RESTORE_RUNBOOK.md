# ShuleHQ — Backup & Restore Runbook

> **Purpose.** Guarantee that no tenant ever loses their work — school finances,
> student records, uploaded documents — under *any* failure: server death, disk
> loss, bad migration, accidental deletion, or provider outage.
>
> **Governing principle:** *the backup you have never restored does not exist.*
> This runbook is not complete until the **Restore Drill (§7)** has been executed
> and signed off.
>
> **Status:** DRAFT for review — Phase 0 of the migration preparation. No code yet.

---

## 1. Objectives (RPO / RTO)

| Metric | Target | Meaning |
|---|---|---|
| **RPO** (Recovery Point Objective) | **≤ 1 hour** (max 24h) | Most data we can afford to lose = time since last good backup |
| **RTO** (Recovery Time Objective) | **≤ 1 hour** | Time to a working system after total loss |
| **Restore-drill cadence** | **Monthly** | Prove restore works — not optional |
| **Retention** | 7 daily · 4 weekly · 6 monthly | Enough history to recover from *undetected* corruption |

At current data size (~110 MB DB), a full backup + restore is minutes, so these
targets are comfortably achievable with simple tooling. Revisit if data grows
past a few GB.

---

## 2. Scope — what a "complete backup" contains

A backup is a **consistent set of two parts**, captured together:

1. **PostgreSQL logical dump** — all schemas (`core` + alembic), all 86 tables,
   via `pg_dump` **custom format** (`-Fc`): compressed, and supports selective /
   parallel restore.
2. **Media archive** — `tar.gz` of `/app/media/student-docs` (uploaded birth
   certs, parent IDs, transfer letters). **Omitting this loses every uploaded
   file** — see System Inventory §2.

A backup missing either part is **incomplete** and must fail loudly, not
silently succeed.

> Not backed up (by design): Redis (rebuildable), node_modules, container images
> (rebuilt by CI from git).

---

## 3. The 3-2-1 rule (how we can't lose everything at once)

| Copy | Where | Medium | Automation |
|---|---|---|---|
| #1 primary | On the VPS (`/var/backups/shulehq/`) | Server SSD | Nightly cron |
| #2 offsite | Contabo Object Storage (or S3-compatible), EU | Object store | Nightly push (`rclone`) |
| #3 cold / human | **Your external hard drive** via admin dashboard download | Removable | On-demand, your control |

Copy #3 is the feature you asked for: a one-click, browser-download backup you
save wherever you want, including an external drive. It is the escape hatch that
survives even the cloud account being lost.

---

## 4. Security of backups (they are PII + financial data)

- **Encrypt at rest.** Every backup artifact is encrypted before it leaves the
  DB host — `age` (recommended) or `gpg`. Offsite copies are ciphertext only.
- **Key escrow.** The decryption key is stored **outside the VPS** (password
  manager + a printed copy in a safe). A backup you can't decrypt is worthless;
  a key that only lives on the server that died is worthless.
- **Least privilege.** The backup role is a dedicated Postgres user with
  read-only replication/dump rights, not the app superuser.
- **Integrity.** Every artifact gets a SHA-256 checksum recorded alongside it;
  restore verifies the checksum before trusting the file.
- **Transport.** Offsite push over TLS; object-storage bucket is private, no
  public listing.

---

## 5. Cadence & automation

| Trigger | What | Retention |
|---|---|---|
| **Nightly cron** (02:00 EAT) | Full backup → local → encrypt → push offsite → prune | 7/4/6 rolling |
| **Pre-migration / pre-deploy** | Full backup, tagged `pre-<change>` | Kept 90 days |
| **On-demand (admin dashboard)** | Full backup, streamed to the operator's browser → external drive | Operator-managed |
| **Post-restore-drill** | Drill result logged | Audit trail |

Every automated run **emits success/failure to monitoring** (§8). A silent
missing backup is the failure mode that kills companies — the alert is on
*absence of success*, not just on error.

---

## 6. The admin-dashboard on-demand backup (feature design)

The "save to my hard drive" capability, at the design level (to be built after
this doc is approved):

```
Admin › Backups
  ┌──────────────────────────────────────────────┐
  │  Create backup now        [ Create & download ]│
  │  ─ streams a single encrypted archive ─        │
  │                                                │
  │  Recent backups            checksum   size  by │
  │  2026-07-.. 02:00  nightly  ✓ok      27 MB  cron│
  │  2026-07-.. 14:03  manual   ✓ok      27 MB  you │
  └──────────────────────────────────────────────┘
```

- **Backend (design):** an admin-only, permission-gated endpoint runs the same
  backup routine as cron, produces the two-part artifact (`pg_dump -Fc` + media
  `tar.gz`) bundled + encrypted, computes the checksum, records a `backups`
  ledger row (who/when/size/checksum/outcome — audited), and **streams** the
  bytes to the browser with `Content-Disposition: attachment`. Streaming, not
  buffering, so a growing DB never blows the app's memory.
- **Frontend (design):** a Backups page under the admin portal — "Create &
  download" button + a history table reading the ledger. Download lands wherever
  the browser save dialog points, including an external drive.
- **Security:** endpoint requires an admin-level permission; every invocation is
  audited (`backup.created` / `backup.downloaded`); rate-limited; the artifact is
  encrypted so an intercepted download is useless.
- **RBAC:** restricted to platform-admin, not tenant users — this is a
  whole-database export.

> Note on the current version skew: because Render runs Postgres **18** and the
> backend image ships client **16**, this endpoint requires **Postgres 18 client
> tools in the backend image** before it can dump the Render server. On the VPS
> (server + client both 18) the problem disappears — another reason the feature
> is cleaner post-migration.

---

## 7. Restore Drill (MANDATORY — the runbook is not "done" until this passes)

Run monthly and before every migration. **Restore into a throwaway target — never
over production.**

```bash
# 0. Pick the artifact to prove (most recent nightly)
BK=/var/backups/shulehq/2026-07-XX          # example

# 1. Verify integrity BEFORE trusting the file
sha256sum -c "$BK/backup.sha256"            # must say: OK

# 2. Decrypt
age -d -i /secure/backup.key "$BK/db.dump.age"   > /tmp/db.dump
age -d -i /secure/backup.key "$BK/media.tgz.age" > /tmp/media.tgz

# 3. Restore DB into a SCRATCH database (Postgres 18 client)
createdb -h <host> -U <admin> shulehq_restore_test
pg_restore -h <host> -U <admin> -d shulehq_restore_test \
           --clean --if-exists --no-owner /tmp/db.dump

# 4. Restore media into a scratch path
mkdir -p /tmp/media-restore && tar xzf /tmp/media.tgz -C /tmp/media-restore

# 5. Point a throwaway app instance at the scratch DB + media and VALIDATE:
#    (this is the proof — data existing is not the same as data working)
```

**Drill acceptance checklist** (all must pass):
- [ ] Checksum verified `OK`
- [ ] `pg_restore` completes with no errors
- [ ] Row-count sanity: `tenants`, `students`, `invoices`, `payments`,
      `attendance_records` counts match production within expected delta
- [ ] A tenant can **log in** against the restored DB
- [ ] An **invoice PDF** generates and its **QR verifies** (exercises DB + media)
- [ ] A **student document** opens (proves the media archive restored)
- [ ] Alembic head on restored DB == production head (`kem1u2l3i4x5` or later)
- [ ] Drill outcome + timestamp recorded in the backup ledger / ops log

If any box fails, the backup pipeline is **broken** and is treated as a P1
incident — fix before relying on it.

---

## 8. Monitoring & alerting

- **Alert on absence of success** — if no `backup.success` event by 03:00 EAT,
  page the operator. (A backup that silently stopped running is the classic
  disaster.)
- Alert on: dump error, offsite-push failure, encryption failure, checksum
  mismatch, disk-space low on `/var/backups`, retention-prune failure.
- Dashboard: last successful backup time, size trend, last successful **restore
  drill** date (stale drill = warning).

---

## 9. Failure playbooks (what to actually do when…)

| Scenario | Action |
|---|---|
| **Bad migration corrupts data** | Stop app → restore latest pre-deploy backup into a fresh DB → repoint app → validate (§7 checklist) |
| **VPS disk/host dies** | Provision new VPS from `deploy/` scripts → restore latest offsite backup → DNS already low-TTL → flip |
| **Whole Contabo account lost** | Restore from copy #3 (your external drive) onto any new host |
| **Accidental tenant/data deletion** | Restore latest backup to scratch DB → extract only the affected rows → re-insert (surgical, no full rollback) |
| **Ransomware / tampering** | Offsite copies are immutable-versioned; restore from a pre-incident version |

---

## 10. Ownership & review

- **Owner:** platform engineer (you).
- **Review cadence:** this document + a live restore drill **monthly**, and
  mandatorily before any migration or major deploy.
- **Change control:** any change to backup scope, cadence, or retention updates
  this file in the same PR.

---

*A backup strategy is only as good as its last successful restore. Schedule the
first drill the day the pipeline is built.*
