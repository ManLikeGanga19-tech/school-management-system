from pathlib import Path
from functools import cached_property

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
    _HAS_PYDANTIC_SETTINGS = True
except Exception:  # pragma: no cover - compatibility fallback
    from pydantic import BaseSettings  # type: ignore

    SettingsConfigDict = None  # type: ignore
    _HAS_PYDANTIC_SETTINGS = False

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ENV_FILE = str(_BACKEND_DIR / ".env")


class Settings(BaseSettings):
    APP_ENV: str = "dev"
    APP_NAME: str = "School Management System API"
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_ACCESS_TTL_MIN: int = 15
    JWT_REFRESH_TTL_DAYS: int = 30
    TENANT_MODE: str = "domain"
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"
    COOKIE_DOMAIN: str = ""
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080,http://127.0.0.1:8080"
    # Base domain for tenant subdomain CORS matching.
    # Set to "shulehq.co.ke" in production to allow any https://<slug>.shulehq.co.ke
    # origin without enumerating every school subdomain.  Leave empty in dev.
    CORS_BASE_DOMAIN: str = ""
    PUBLIC_OAUTH_SHARED_SECRET: str = ""

    # Conservative defaults for local/dev and safe production baseline.
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_SEC: int = 30
    DB_POOL_RECYCLE_SEC: int = 1800
    DB_POOL_PRE_PING: bool = True
    # PostgreSQL SSL mode for managed databases (RDS, Supabase, Railway, etc.).
    # Empty = no override (local Docker Postgres, no SSL cert needed).
    # "require"      = encrypted connection, no cert verification.
    # "verify-full"  = encrypted + CA cert verification (most secure; requires PGSSLROOTCERT).
    DB_SSL_MODE: str = ""

    # Rate limiting
    # Tenant bucket: the entire school (all its users) shares this limit.
    # A whole school doing 2000 req/min is healthy traffic; raise if legitimate
    # usage triggers false positives.  Per-route overrides (login = 5/min, etc.)
    # are not affected by this value — they use their own declared limits.
    RATE_LIMIT_TENANT_PER_MINUTE: int = 2000

    # Redis
    # REDIS_URL is the base URL without credentials.
    # REDIS_PASSWORD is injected separately so it never appears in plain-text
    # log output (URLs are commonly logged; passwords should not be).
    # The authenticated URL is assembled at runtime via redis_url property.
    REDIS_URL: str = "redis://redis:6379/0"
    REDIS_PASSWORD: str = ""  # Set in production; leave empty for no-auth dev

    # Daraja (M-Pesa STK) integration
    DARAJA_ENV: str = "sandbox"  # sandbox | production
    DARAJA_CONSUMER_KEY: str = ""
    DARAJA_CONSUMER_SECRET: str = ""
    DARAJA_SHORTCODE: str = ""
    DARAJA_PASSKEY: str = ""
    DARAJA_CALLBACK_BASE_URL: str = ""
    DARAJA_CALLBACK_TOKEN: str = ""
    DARAJA_TIMEOUT_SEC: int = 30
    DARAJA_USE_MOCK: bool = False
    DARAJA_SANDBOX_FALLBACK_TO_MOCK: bool = False
    DARAJA_CALLBACK_HMAC_SECRET: str = ""  # Optional: HMAC envelope verification via relay proxy
    # Deduplication window for STK push initiation.  If a PENDING payment for
    # the same tenant / subscription / phone / amount exists within this window,
    # the existing checkout_request_id is returned instead of firing a new push.
    # 300 s (5 min) matches the M-Pesa STK prompt expiry.  Set to 0 to disable.
    DARAJA_DEDUP_WINDOW_SEC: int = 300

    # Africa's Talking (SMS provider)
    # ShuleHQ holds one AT account; all tenant SMS goes through it.
    # Set AT_USE_MOCK=true for CI and local dev to skip real AT calls.
    AT_USERNAME: str = ""
    AT_API_KEY: str = ""
    AT_SENDER_ID: str = "ShuleHQ"      # Registered alphanumeric sender
    AT_SANDBOX: bool = True            # false in production
    AT_USE_MOCK: bool = False          # true in CI/test
    AT_TIMEOUT_SEC: int = 15
    # Units to deduct per SMS segment (160 chars = 1 unit, >160 = 2+ units)
    AT_UNITS_PER_SEGMENT: int = 1
    AT_CHARS_PER_SEGMENT: int = 160

    # Audit log retention.  Rows older than this many days are deleted at
    # application startup.  90 days satisfies typical compliance requirements
    # while keeping the table size bounded.  Set to 0 to disable pruning.
    AUDIT_LOG_RETENTION_DAYS: int = 90

    if _HAS_PYDANTIC_SETTINGS:
        model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")
    else:
        class Config:
            env_file = _ENV_FILE
            extra = "ignore"

    @cached_property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @cached_property
    def cors_origin_regex(self) -> str | None:
        """
        Derive a regex that matches any HTTPS tenant subdomain under CORS_BASE_DOMAIN.

        Example: CORS_BASE_DOMAIN=shulehq.co.ke
          Allows:  https://greenhill.shulehq.co.ke
          Rejects: http://greenhill.shulehq.co.ke  (no HTTP — must be HTTPS)
                   https://evil.com                 (wrong domain)
                   https://.shulehq.co.ke           (empty subdomain)

        Tenant slugs are lowercase letters, digits, and hyphens — the regex
        enforces this, preventing path-traversal and look-alike attacks.
        Returns None when CORS_BASE_DOMAIN is not configured (dev default).
        """
        domain = str(self.CORS_BASE_DOMAIN or "").strip()
        if not domain:
            return None
        import re
        escaped = re.escape(domain)
        return rf"^https://[a-z0-9][a-z0-9\-]*\.{escaped}$"

    @cached_property
    def database_url_with_ssl(self) -> str:
        """
        Return DATABASE_URL with sslmode injected when DB_SSL_MODE is set.

        Leaves the URL unchanged in dev (DB_SSL_MODE="").
        Set DB_SSL_MODE=require for managed PostgreSQL (RDS, Supabase, Railway).
        Set DB_SSL_MODE=verify-full when you also supply PGSSLROOTCERT (CA cert).

        Using a separate env var keeps DATABASE_URL readable/loggable without
        exposing SSL configuration details alongside credentials.
        """
        ssl_mode = str(self.DB_SSL_MODE or "").strip()
        if not ssl_mode:
            return self.DATABASE_URL
        from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
        parsed = urlparse(self.DATABASE_URL)
        params = parse_qs(parsed.query, keep_blank_values=True)
        params["sslmode"] = [ssl_mode]
        new_query = urlencode({k: v[0] for k, v in params.items()})
        return urlunparse(parsed._replace(query=new_query))

    @cached_property
    def redis_url_with_auth(self) -> str:
        """
        Return the Redis URL with password injected when REDIS_PASSWORD is set.

        redis-py / aioredis expect the password in the URL as:
            redis://:password@host:port/db
        Note the leading colon before the password (no username).
        Using a separate REDIS_PASSWORD env var keeps the password out of logs
        that may capture REDIS_URL.
        """
        password = str(self.REDIS_PASSWORD or "").strip()
        if not password:
            return self.REDIS_URL
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(self.REDIS_URL)
        host = parsed.hostname or "redis"
        port = parsed.port or 6379
        db_path = parsed.path or "/0"
        netloc = f":{password}@{host}:{port}"
        return urlunparse(parsed._replace(netloc=netloc, path=db_path))


settings = Settings()
