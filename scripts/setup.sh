#!/usr/bin/env bash
# One-shot local setup for macOS / Linux.   Usage:  bash scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Python virtualenv + dependencies"
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip >/dev/null
./.venv/bin/pip install -r scraper/requirements-dev.txt

echo "==> Backend dependencies"
(cd backend && npm install)
[ -f backend/.env ] || cp backend/.env.example backend/.env

echo "==> Frontend dependencies"
(cd frontend && npm install)
[ -f frontend/.env.local ] || cp frontend/.env.example frontend/.env.local

cat <<'MSG'

Setup finished. Next:
  1) ./.venv/bin/python -m scraper.run        # first data load (optional - the UI can trigger it too)
  2) cd backend  && npm start                 # API on http://localhost:4000
  3) cd frontend && npm run dev               # UI  on http://localhost:3000
MSG
