# infra/nginx/Dockerfile

FROM nginx:1.27-alpine

ENV NEXT_STATIC_CACHE_CONTROL=public,max-age=31536000,immutable

COPY nginx.conf.template /etc/nginx/templates/nginx.conf.template

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/nginx-healthz >/dev/null || exit 1

CMD ["/bin/sh", "-c", "envsubst '${NEXT_STATIC_CACHE_CONTROL}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf && exec nginx -g 'daemon off;'"]
