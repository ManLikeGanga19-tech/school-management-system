# backend/Dockerfile

FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY requirements.txt ./
RUN pip install --upgrade pip setuptools wheel && pip install -r requirements.txt

COPY . .
RUN python -m compileall app


FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

# Runtime deps + PostgreSQL 18 client tools (pg_dump / pg_restore / psql).
# Debian's default repo doesn't carry v18, and the production database is
# PostgreSQL 18 — a v16 pg_dump REFUSES to dump an v18 server. We install
# the v18 client from the official PGDG apt repository so the in-app backup
# feature can dump both the dev (16) and production (18) servers (a newer
# client dumping an older server is supported; the reverse is not).
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    libpq5 \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --create-home --home-dir /home/appuser appuser

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app/app /app/app
COPY --from=builder /app/alembic.ini /app/alembic.ini
COPY --from=builder /app/alambic /app/alambic
COPY --from=builder /app/gunicorn.conf.py /app/gunicorn.conf.py
COPY --from=builder /app/scripts /app/scripts

# Create writable storage directory for tenant badge uploads and chown to appuser.
# The volume declared in docker-compose.prod.yml mounts here so badges survive redeploys.
RUN mkdir -p /app/storage/tenant_badges && \
    chown -R appuser:appgroup /app/storage

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail http://127.0.0.1:8000/readyz || exit 1

USER appuser

CMD ["gunicorn", "app.main:app", "--config", "/app/gunicorn.conf.py"]
