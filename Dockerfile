# Backend API + Python pipeline in ONE image.
# The Node API spawns `python -m scraper.run` for POST /ingest/trigger, so both runtimes must live together.
# Build context = repository root (this file's directory).
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies (cached layer)
COPY scraper/requirements.txt scraper/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r scraper/requirements.txt

# Node dependencies (cached layer)
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev

# Application code
COPY db db
COPY scraper scraper
COPY backend backend

ENV NODE_ENV=production \
    PORT=4000 \
    PYTHON_BIN=/opt/venv/bin/python

WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "src/server.js"]
