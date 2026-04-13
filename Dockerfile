# Next.js + Python (XBRL compiler). For Render, Fly, Railway, etc.
# Build: docker build -t century-egg-credit .
# Run:  docker run -p 3000:3000 --env-file .env.production century-egg-credit

FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# --- Runtime ---
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Python 3 + venv for xbrl-compiler (spawn "python" → venv's python on PATH)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/xbrl-venv
ENV PATH="/opt/xbrl-venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

COPY --from=builder /app /app

RUN pip install --no-cache-dir -r xbrl-compiler/requirements.txt

ENV PYTHONPATH=/app/xbrl-compiler
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# Render sets PORT; Next reads it automatically
CMD ["sh", "-c", "exec npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
