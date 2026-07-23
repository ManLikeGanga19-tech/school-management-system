#!/usr/bin/env python3
"""
ShuleHQ external watchdog.

Runs OUTSIDE the production VPS (GitHub Actions) — deliberately. A monitor
hosted on the machine it watches goes down exactly when it is needed, so this
must never be moved onto the VPS.

Checks:
  * HTTP reachability of the public endpoints
  * TLS certificate expiry (catches a silent renewal failure months early)

Writes a machine-readable status document to --out (consumed later by the
public status page) and exits non-zero if any CRITICAL check failed.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# host, path, allowed status codes, severity
DEFAULT_TARGETS = [
    ("api.shulehq.co.ke", "/readyz", {200}, "critical"),
    ("novel-school.shulehq.co.ke", "/", {200, 301, 302, 307, 308}, "critical"),
    ("shulehq.co.ke", "/", {200, 301, 302, 307, 308}, "critical"),
    ("admin.shulehq.co.ke", "/", {200, 301, 302, 307, 308}, "warning"),
]

# Secret header so Cloudflare's WAF can BYPASS the challenge for this monitor.
# Without it, a Managed Challenge on browser paths makes every probe fail and
# the watchdog pages about an outage that is not happening. Not spoofable
# without the token, unlike matching on User-Agent.
WATCHDOG_TOKEN = os.environ.get("WATCHDOG_TOKEN", "")

TLS_WARN_DAYS = int(os.environ.get("TLS_WARN_DAYS", "21"))
TIMEOUT = int(os.environ.get("CHECK_TIMEOUT", "20"))


def check_http(host: str, path: str, allowed: set[int], severity: str) -> dict:
    url = f"https://{host}{path}"
    started = time.monotonic()
    try:
        req = urllib.request.Request(url, method="GET", headers=_headers())
        # Do not follow redirects: a 307 to /login is a healthy answer.
        opener = urllib.request.build_opener(_NoRedirect)
        with opener.open(req, timeout=TIMEOUT) as resp:
            code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:  # DNS failure, refused, TLS error, timeout
        return {"name": host + path, "kind": "http", "ok": False,
                "severity": severity, "detail": f"unreachable: {type(e).__name__}: {e}",
                "ms": int((time.monotonic() - started) * 1000)}
    ms = int((time.monotonic() - started) * 1000)
    ok = code in allowed
    return {"name": host + path, "kind": "http", "ok": ok, "severity": severity,
            "detail": f"HTTP {code}" + ("" if ok else f" (expected one of {sorted(allowed)})"),
            "ms": ms}


def _headers() -> dict[str, str]:
    h = {"User-Agent": "shulehq-watchdog/1"}
    if WATCHDOG_TOKEN:
        h["X-Watchdog-Token"] = WATCHDOG_TOKEN
    return h


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def check_tenant_auth(host: str) -> dict:
    """Deep end-to-end check: Caddy -> nginx -> backend -> Postgres -> argon2.

    A deliberately wrong password against a REAL tenant must return 401
    ("Invalid credentials"). This is the only check that proves the database
    is actually being read:

        401  tenant resolved from the DB, user table queried, hash compared  -> healthy
        400  "Tenant not resolved" — DB or tenant lookup is broken
        5xx  backend broken

    A plain GET cannot distinguish these: the wildcard DNS + wildcard cert mean
    ANY hostname returns a healthy-looking 307, even a tenant that
    does not exist.
    """
    url = f"https://{host}/api/v1/auth/login"
    # NOTE: the address must pass the API's email validation, otherwise the
    # request is rejected with 422 before auth is ever exercised and the check
    # proves nothing. A reserved-for-testing domain (RFC 2606) is used, not a
    # bogus TLD.
    body = json.dumps({"email": "watchdog-probe@example.com",
                       "password": "not-a-real-password"}).encode()
    started = time.monotonic()
    try:
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={**_headers(), "Content-Type": "application/json"})
        urllib.request.build_opener(_NoRedirect).open(req, timeout=TIMEOUT)
        code = 200  # a 200 here would mean our bogus password was accepted
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:
        return {"name": f"auth:{host}", "kind": "auth", "ok": False, "severity": "critical",
                "detail": f"unreachable: {type(e).__name__}: {e}",
                "ms": int((time.monotonic() - started) * 1000)}
    ms = int((time.monotonic() - started) * 1000)
    if code == 401:
        return {"name": f"auth:{host}", "kind": "auth", "ok": True, "severity": "critical",
                "detail": "401 — tenant resolved, DB reachable, auth working", "ms": ms}
    detail = {
        400: "400 — TENANT NOT RESOLVED: database or tenant lookup is broken",
        200: "200 — a bogus password was ACCEPTED: authentication is broken",
    }.get(code, f"HTTP {code} (expected 401)")
    return {"name": f"auth:{host}", "kind": "auth", "ok": False,
            "severity": "critical", "detail": detail, "ms": ms}


def check_tls(host: str, connect_to: str | None = None, label: str | None = None) -> dict:
    """Days remaining on a served certificate.

    `connect_to` lets us bypass DNS and speak to a specific IP while still
    sending `host` as SNI. That matters once Cloudflare proxies the domain:
    a normal lookup then returns CLOUDFLARE's edge certificate, which
    Cloudflare renews itself and which therefore never alerts. The certificate
    that can actually break is Caddy's on the ORIGIN — under SSL mode
    "Full (strict)" an expired origin cert makes Cloudflare refuse the
    connection and the whole site returns error 526.
    """
    name = label or f"tls:{host}"
    target = connect_to or host
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((target, 443), timeout=TIMEOUT) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
        not_after = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(
            tzinfo=timezone.utc)
        days = (not_after - datetime.now(timezone.utc)).days
    except Exception as e:
        return {"name": name, "kind": "tls", "ok": False, "severity": "critical",
                "detail": f"could not read certificate: {type(e).__name__}: {e}", "days": None}
    # Expired is critical; approaching expiry is a warning worth acting on early.
    if days < 0:
        return {"name": name, "kind": "tls", "ok": False, "severity": "critical",
                "detail": f"CERTIFICATE EXPIRED {abs(days)}d ago", "days": days}
    ok = days >= TLS_WARN_DAYS
    return {"name": name, "kind": "tls", "ok": ok, "severity": "warning",
            "detail": f"expires in {days}d ({not_after:%Y-%m-%d})", "days": days}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="status.json")
    args = ap.parse_args()

    results = [check_http(h, p, a, s) for h, p, a, s in DEFAULT_TARGETS]
    # The deep one: proves the database is actually being read, which no plain
    # GET can establish while a wildcard cert answers every hostname.
    results.append(check_tenant_auth(os.environ.get("PROBE_TENANT_HOST",
                                                    "novel-school.shulehq.co.ke")))
    results.append(check_tls("novel-school.shulehq.co.ke", label="tls:edge"))
    # The one that can actually break: Caddy's cert on the origin. Once
    # Cloudflare proxies the zone this is invisible to a normal lookup, yet an
    # expired origin cert under "Full (strict)" takes the entire site down (526).
    origin = os.environ.get("ORIGIN_IP", "94.72.102.13")
    results.append(check_tls("novel-school.shulehq.co.ke", connect_to=origin,
                             label=f"tls:origin({origin})"))

    failed = [r for r in results if not r["ok"]]
    critical = [r for r in failed if r["severity"] == "critical"]
    overall = "down" if critical else ("degraded" if failed else "operational")

    doc = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "overall": overall,
        "checks": results,
    }
    with open(args.out, "w") as fh:
        json.dump(doc, fh, indent=2)

    for r in results:
        print(f"  {'OK  ' if r['ok'] else 'FAIL'}  {r['name']:<42} {r['detail']}")
    print(f"\noverall: {overall}")

    # Emit a summary the notifier can use verbatim.
    if failed:
        lines = [f"{r['name']}: {r['detail']}" for r in failed]
        with open(os.environ.get("GITHUB_ENV", "/dev/null"), "a") as fh:
            fh.write(f"WATCHDOG_SEVERITY={'critical' if critical else 'warning'}\n")
            fh.write(f"WATCHDOG_SUMMARY={'; '.join(lines)[:400]}\n")

    return 1 if critical else 0


if __name__ == "__main__":
    sys.exit(main())
