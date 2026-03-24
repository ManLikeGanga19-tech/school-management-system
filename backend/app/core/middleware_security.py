from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Adds security-relevant HTTP response headers to every response.

    These headers are defence-in-depth for an API server. The Next.js
    frontend manages its own CSP via next.config; these headers cover
    FastAPI-level responses including error pages and health endpoints.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response: Response = await call_next(request)

        # Prevent the API from being embedded in iframes (clickjacking).
        response.headers["X-Frame-Options"] = "DENY"

        # Prevent MIME-type sniffing — server-declared Content-Type is authoritative.
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Legacy XSS filter (belt-and-suspenders; modern browsers rely on CSP).
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Referrer: send full URL to same origin, only origin to cross-origin.
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Disable browser features this API never needs.
        response.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=(), payment=()"
        )

        # HSTS: only meaningful over HTTPS. Guarded by COOKIE_SECURE as a
        # production signal — do not set on HTTP-only dev environments.
        if settings.COOKIE_SECURE:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )

        # Strict CSP for API-only responses: no resources should ever be
        # loaded from these endpoints. frame-ancestors repeats X-Frame-Options
        # for CSP-aware browsers.
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'"
        )

        return response
