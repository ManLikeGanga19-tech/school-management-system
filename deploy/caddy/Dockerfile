# ShuleHQ — custom Caddy image with the Cloudflare DNS plugin (Phase 2).
#
# Wildcard TLS (*.shulehq.co.ke) requires the ACME DNS-01 challenge, which
# needs a DNS-provider plugin compiled into Caddy. The stock caddy:2-alpine
# image has no DNS plugins, so we build one with caddy-dns/cloudflare via
# xcaddy, then copy the binary onto the slim runtime image.
#
# Built + pushed by CI (ci.yml) as
# ghcr.io/manlikeganga19-tech/school-management-system-caddy, same as the
# nginx image. The Caddyfile is mounted at deploy time (docker-compose.prod).

FROM caddy:2-builder-alpine AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
