# Handoff → ShuleHQ Claude session: make the shared Caddy co-tenant-safe

**Paste this whole file to the ShuleHQ repo's Claude Code session.** It is a
coordinated change; the Wooden Houses Kenya (WHK) side is **already done** (see
§"WHK side — already in place"). You only need the 3 edits in §"Your task".

---

## Why (context)

ShuleHQ shares its box and its **single Caddy** (`sms-caddy`) with a second app,
**Wooden Houses Kenya** (`woodenhouseskenya.com`, containers `woodenhouses-frontend`
/ `woodenhouses-backend`). Only one process can own :443, so WHK's public traffic
goes through *your* Caddy.

On **2026-07-25 ~06:11 UTC a ShuleHQ deploy took WHK down (Cloudflare 525, ~40
min)** because your deploy:
1. **overwrote `/opt/shulehq/Caddyfile`**, wiping WHK's appended site block, and
2. **recreated `sms-caddy`**, detaching it from the `whk-edge-net` Docker network.

Result: Caddy had no WHK config and couldn't reach WHK's containers → no cert
presented → CF↔origin TLS handshake failed. ShuleHQ itself was unaffected.

This will recur on **every** ShuleHQ deploy until the change below is made. The
fix decouples WHK's edge config from your deploys **permanently** and does **not**
change any ShuleHQ behaviour.

---

## WHK side — already in place (do NOT recreate these)

- Host file **`/opt/caddy-sites/woodenhouses.caddy`** exists (WHK's site block +
  its own Cloudflare-scoped token). It lives **outside `/opt/shulehq`**, so your
  deploys never touch it.
- Docker networks **`whk-edge-net`** and **`whk-db-net`** exist (so `external:
  true` will resolve — do not create them).

So your deploy just needs to (a) mount that sites dir, (b) `import` it, and (c)
keep `sms-caddy`/`sms-postgres` attached to the WHK networks across recreates.

---

## Your task — 3 one-time edits in the ShuleHQ repo

### Edit 1 — `docker-compose.prod.yml`: declare the WHK networks as external

Top-level `networks:` block — add both (they already exist on the box):

```yaml
networks:
  backend-net:
    driver: bridge
  frontend-net:
    driver: bridge
  whk-edge-net:            # ADD — WHK's edge net (pre-created, do not manage)
    external: true
  whk-db-net:              # ADD
    external: true
```

### Edit 2 — `docker-compose.prod.yml`: attach caddy + postgres to them, and mount the sites dir

On the **`caddy`** service — add `whk-edge-net` to its `networks:` list and add the
read-only sites mount (keep everything else):

```yaml
  caddy:
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - /opt/caddy-sites:/etc/caddy/sites:ro    # ADD
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - frontend-net
      - whk-edge-net                            # ADD
```

On the **`postgres`** service (`sms-postgres`) — add `whk-db-net` to its
`networks:` list so WHK's backend keeps DB access across a postgres recreate:

```yaml
    networks:
      - backend-net
      - whk-db-net                              # ADD
```

### Edit 3 — `Caddyfile`: import the sites dir (one line, at the top level)

Add this line at the **global/top level** of the ShuleHQ `Caddyfile` (NOT inside a
site block — e.g. put it right after the global `{ … }` options block):

```
import /etc/caddy/sites/*.caddy
```

> **Do NOT** paste WHK's site block into the ShuleHQ Caddyfile. The `import`
> pulls it from `/opt/caddy-sites/woodenhouses.caddy`. Having both would be a
> duplicate-site error.

---

## Deploy + verify (neighbour-safe)

1. **Before deploy**, capture WHK health so you can prove you didn't break it:
   ```bash
   curl -s -o /dev/null -w 'WHK before: %{http_code}\n' https://www.woodenhouseskenya.com/
   ```
   (Expect `200`.)

2. Deploy ShuleHQ as normal. Your `caddy validate` will now also parse the WHK
   block — it parses fine (config-only; no DNS needed). Runtime proxy works
   because `whk-edge-net` (external) keeps `sms-caddy` attached.

3. **After deploy**, verify BOTH tenants:
   ```bash
   curl -s -o /dev/null -w 'ShuleHQ: %{http_code}\n' https://shulehq.co.ke/
   curl -s -o /dev/null -w 'WHK www: %{http_code}\n' https://www.woodenhouseskenya.com/
   curl -s -o /dev/null -w 'WHK api: %{http_code}\n' https://api.woodenhouseskenya.com/health
   # on-box network attachment survived the recreate:
   docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' sms-caddy
   ```
   Expect ShuleHQ `200/403`, WHK `200`, and `whk-edge-net` present on `sms-caddy`.

4. **Optional hardening** (recommended): add a WHK before/after health check to
   your own deploy workflow (mirror of the ShuleHQ neighbour check WHK already
   runs), so a future ShuleHQ deploy that impacts WHK aborts loudly instead of
   silently 525-ing it.

---

## Rollback

If anything misbehaves, revert the 3 edits and redeploy. The WHK file and
networks are external/independent, so reverting ShuleHQ leaves them intact — WHK
simply goes back to depending on the on-box appended block (which the WHK session
will have restored). No ShuleHQ data or config is touched by any of this.

---

## One-line summary for the ShuleHQ session

> Add `whk-edge-net`/`whk-db-net` as `external: true`, attach `sms-caddy` to
> `whk-edge-net` and `sms-postgres` to `whk-db-net`, mount `/opt/caddy-sites` →
> `/etc/caddy/sites:ro` on caddy, and add `import /etc/caddy/sites/*.caddy` to the
> Caddyfile. The WHK file + networks already exist on the box. Verify both
> `shulehq.co.ke` and `woodenhouseskenya.com` return healthy after deploy.
