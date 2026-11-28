# QFleet · Team Nonchalant: one container serves the API and the built web app.
#   docker build -t qfleet .
#   docker run --env-file backend/.env -p 8787:8787 qfleet
# For x86 cloud hosts when building on Apple Silicon: docker buildx build --platform linux/amd64 -t qfleet .
# Railway builds this file directly (see railway.json) and injects PORT.

# ---------------------------------------------------------------- 1 · build the web app
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------- 2 · Python runtime
FROM python:3.13-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_HTTP_TIMEOUT=300 \
    UV_CONCURRENT_DOWNLOADS=4 \
    UV_HTTP_RETRIES=10 \
    NUMBA_CACHE_DIR=/tmp/numba \
    QFLEET_DIST=/app/frontend/dist \
    PORT=8787
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /usr/local/bin/uv

WORKDIR /app/backend
# dependencies first (cached layer), then the code
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev
COPY --from=web /web/dist /app/frontend/dist

# Run unprivileged. Code stays root-owned and read-only; only the app folder itself is writable
# (local SQLite fallback); caches go to /tmp. No recursive chown, so the image isn't duplicated.
RUN useradd --create-home --uid 10001 qfleet && chown qfleet /app/backend
USER qfleet

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT','8787'), timeout=4)"

# One worker on purpose: autopilot runs, QPU jobs and solver pools live in this process.
CMD ["sh", "-c", "exec /app/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 30"]
