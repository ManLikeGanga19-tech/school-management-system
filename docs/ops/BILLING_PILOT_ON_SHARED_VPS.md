# WiFi/ISP Billing — Pilot on the Shared VPS (then migrate)

> How to run the ISP billing system (FreeRADIUS + MikroTik integration + billing
> portal) **as a low-scale pilot** on the existing Contabo VPS that already runs
> ShuleHQ and woodenhouses — without disturbing either — and the trigger + plan
> to move it to its own box before real subscriber load.
>
> Snapshot taken 2026-07-25. Re-measure before acting; numbers drift.

---

## 0. The two hard rules

1. **DO NOT touch the workloads already on this box.** ShuleHQ (live, paying)
   and woodenhouses are running with their current containers, ceilings, volumes,
   networks and env. The billing pilot is *additive only* — new containers, new
   database, new network, new deploy path. Never edit, restart for convenience,
   re-tune, or share the DB/redis/volumes of the existing apps.
2. **This is a PILOT for integration validation, not production scale.** It runs
   here only while there are a handful of PPPoE/hotspot sessions (your own).
   Before any real ISP/subscribers depend on it, it **moves to a dedicated VPS**
   (see §7). Co-hosting a 2,000-subscriber real-time RADIUS system here is out of
   scope and unsafe — that was the original recommendation and it still stands.

---

## 1. The VPS as it is now (2026-07-25)

| Resource | Value |
|---|---|
| vCPU | **4** |
| RAM | **7.8 GB** (7629 MB) |
| Swap | 4 GB (0 used) |
| Disk | 96 GB — **12 GB used (12%), 85 GB free** |
| Load | ~0.07 (idle) |
| Actual RAM in use | **~1.3 GB** |

**Running containers, ceilings vs actual use:**

| Container | CPU ceiling | Mem ceiling | Mem actual | Owner |
|---|---|---|---|---|
| sms-backend | 2.00 | 1536m | 327 MB | ShuleHQ |
| sms-postgres | 1.50 | 2048m | 111 MB | ShuleHQ |
| sms-frontend | 1.00 | 1024m | 78 MB | ShuleHQ |
| sms-redis | 0.50 | 512m | 6 MB | ShuleHQ |
| sms-nginx | 0.50 | 256m | 5 MB | ShuleHQ |
| sms-caddy | 0.50 | 256m | 14 MB | ShuleHQ (edge) |
| sms-dozzle | 0.10 | 64m | 11 MB | ShuleHQ (logs) |
| woodenhouses-backend | 1.00 | 768m | 87 MB | woodenhouses |
| woodenhouses-frontend | 0.50 | 512m | 64 MB | woodenhouses |

- **Committed memory ceilings: ~6976 MB of 7629 MB (~91%).**
- **Committed CPU ceilings: ~7.6 of 4 vCPU** (oversubscribed — expected; ceilings
  are limits, not reservations, so idle apps don't hold cores).
- **Actual usage of everything above: ~700 MB.** The ceilings are deliberately
  generous (ShuleHQ kept high for headroom); real consumption is tiny.

### What woodenhouses uses (so billing doesn't crowd it)
- Two containers only: `woodenhouses-backend` (1.0 CPU / 768m, ~87 MB actual) and
  `woodenhouses-frontend` (0.5 CPU / 512m, ~64 MB actual). ~150 MB actual total.
- **No woodenhouses Postgres/Redis volume is present** — it either uses an
  external DB or none. Do not assume it can share, and do not touch it.
- Caddy (`sms-caddy`) is the shared TLS edge for the box. woodenhouses is served
  through it. The billing **web portal** would also route through Caddy; the
  **RADIUS** path does not (see §4).

---

## 2. Headroom for the billing pilot — read this carefully

There are **two different headrooms**, and conflating them is how boxes fall over:

- **Physical headroom (what actually exists):** ~6.4 GB RAM free right now, 85 GB
  disk, CPU almost idle. Plenty for a 2-session pilot.
- **Committed-ceiling headroom (what's promised):** only **~650 MB** of memory
  ceiling is uncommitted (7629 − 6976).

For a **pilot**, allocate **tight hard ceilings** and accept that the *ceiling
sum* will slightly oversubscribe RAM. That is safe **only because** ShuleHQ and
woodenhouses use a fraction of their ceilings — the OOM killer acts on *actual*
memory, and actual will stay well under 7.8 GB at pilot scale. The moment real
load makes actual usage climb, that safety evaporates → which is exactly the
migration trigger (§7).

### Recommended pilot ceilings (hard caps on every container)

| Container | CPU | Mem | Why |
|---|---|---|---|
| `billing-freeradius` | 0.25 | 128m | RADIUS is lightweight; 2 sessions is nothing |
| `billing-api` | 0.50 | 384m | billing logic + accounting writes |
| `billing-portal` | 0.25 | 256m | subscriber/admin web UI (static-export if possible) |
| `billing-postgres` | 0.50 | 512m | its OWN database — never ShuleHQ's |
| **pilot total** | **~1.5** | **~1.28 GB** | actual use expected ~300–400 MB |

- These are **caps so a pilot bug can't starve ShuleHQ or woodenhouses**, not
  reservations. Keep them; do not raise them to "make room" — if you need more,
  that's the signal to migrate, not to grow here.
- Disk: RADIUS accounting grows with sessions; at pilot scale it's negligible,
  but it's the fastest-growing thing later — another reason the real system wants
  its own box with more disk.

---

## 3. Isolation checklist (mandatory, even for a pilot)

- [ ] **Own deploy path**: `/opt/billing` (never `/opt/shulehq`).
- [ ] **Own compose project**: run with `-p billing` so container/volume/network
      names can never collide with ShuleHQ or woodenhouses.
- [ ] **Own Postgres** (`billing-postgres`) with its own volume. Do **not** use
      `sms-postgres` — separation keeps ShuleHQ's DB uncontended and makes the
      later migration a clean dump/restore.
- [ ] **Own Docker network** — billing containers talk only to each other.
- [ ] **Own secrets / env file**, gitignored. New RADIUS shared secret, new DB
      password. Reuse nothing from ShuleHQ.
- [ ] **Hard `cpus` + `mem_limit`** on every container (§2).
- [ ] Before AND after bringing the pilot up, confirm ShuleHQ is unaffected:
      `curl https://api.shulehq.co.ke/readyz` → 200, and
      `bash deploy/healthcheck.sh`.

---

## 4. RADIUS / MikroTik specifics

- MikroTik → VPS on **UDP 1812** (auth), **UDP 1813** (accounting), and possibly
  **UDP 3799** (CoA / disconnect). These are **not** currently open — UFW allows
  only 22/80/443.
- **Open them locked to the MikroTik's source IP**, not the whole internet:
  ```
  sudo ufw allow from <MIKROTIK_PUBLIC_IP> to any port 1812 proto udp
  sudo ufw allow from <MIKROTIK_PUBLIC_IP> to any port 1813 proto udp
  # add 3799 only if using CoA/disconnect
  ```
  A static MikroTik IP is strongly preferred; a dynamic one forces a wider,
  riskier rule.
- **RADIUS bypasses Cloudflare.** It's UDP, so the MikroTik points at the
  **origin IP directly** (`94.72.102.13:1812/1813`), NOT the proxied hostname and
  NOT through Caddy. No Cloudflare/Turnstile complication on the RADIUS path.
- The **billing web portal** (HTTP) *does* go through Caddy — add a Caddy site
  block for its hostname, same pattern as ShuleHQ/woodenhouses.
- The subscribers' actual internet traffic never traverses this VPS — the
  MikroTik handles the data plane. The box only carries RADIUS control-plane +
  the portal. So this is a **latency/continuity** system, not a bandwidth one.

---

## 5. What NOT to do (protecting the live systems)

- Don't restart, rebuild, re-tune, or "tidy" ShuleHQ or woodenhouses containers.
- Don't lower ShuleHQ's ceilings to make room — they're intentionally generous
  for performance, and the pilot fits in physical headroom without it.
- Don't point billing at `sms-postgres` or `sms-redis`.
- Don't open RADIUS ports to `0.0.0.0` — scope to the MikroTik IP.
- Don't route RADIUS through Cloudflare/Caddy.
- Don't let the pilot run uncapped — every container gets a hard limit.

---

## 6. Monitoring during the pilot

- Watch **RADIUS auth latency** whenever ShuleHQ runs a report/export or either
  app redeploys. At 2 sessions you won't feel contention; if you ever see RADIUS
  timeouts coinciding with a ShuleHQ/woodenhouses CPU spike, the migration
  trigger has arrived early.
- `docker stats --no-stream` — confirm the pilot's actual use stays small and no
  container is pinned at its CPU ceiling (`nr_throttled` climbing in
  `deploy/healthcheck.sh` is the early warning).
- Keep the existing watchdog + nightly backups untouched; add billing's own
  backup + monitoring when it graduates to its own box.

---

## 7. Migration trigger + procedure

**Migrate to a dedicated VPS before whichever comes first:**
- onboarding a second ISP or any real paying subscribers, or
- crossing ~a few dozen concurrent live sessions, or
- the pilot needing more than its allotted ceilings, or
- any RADIUS latency tied to neighbour CPU spikes.

**Because the pilot has its own DB + compose project, migration is a lift:**
1. Provision the new VPS with `deploy/provision.sh` (hardened; note the
   first-wins sshd fix already in it).
2. Size it for the real profile: FreeRADIUS + N-thousand PPPoE + hotspot →
   more RAM and **much more disk** for accounting growth; give RADIUS its own
   Postgres. (Ask for specific sizing when you get there.)
3. `pg_dump` the billing DB here → `pg_restore` on the new box.
4. Repoint the MikroTik to the new IP; move the portal's DNS/Caddy block.
5. Verify RADIUS auth + accounting end-to-end, then decommission the pilot here.

---

## 8. One-line summary

Pilot the billing system here **additively and hard-capped** to validate the
MikroTik/RADIUS integration in production with your own handful of sessions;
keep it fully isolated (own DB, network, deploy path, ports scoped to the
MikroTik); touch nothing that ShuleHQ or woodenhouses owns; and **move it to its
own VPS before real subscribers arrive.**
