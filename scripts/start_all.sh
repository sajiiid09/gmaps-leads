#!/usr/bin/env bash
# Start the full gmaps-leads stack: Postgres (docker), backend API, unified worker,
# frontend. Idempotent: bootstraps .env / .venv / node_modules / migrations on first run.
# Services run in a tmux session named "gmaps-leads" (one window per service).
# The worker handles all job types (scrape | enrich | score) sequentially.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SESSION="gmaps-leads"
PY=".venv/bin/python"

log() { printf '\033[1;32m[start_all]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[start_all]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- 0. Dependencies (docker, tmux, node/npm, python3) ------------------------
missing=()
for tool in docker tmux node npm python3; do
  command -v "$tool" >/dev/null || missing+=("$tool")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  log "missing dependencies: ${missing[*]} — running installer"
  bash "$ROOT/scripts/install_deps.sh"
  for tool in "${missing[@]}"; do
    command -v "$tool" >/dev/null || die "$tool still not found after install — install it manually and re-run"
  done
fi

# docker binary may exist while the daemon is down — installer also handles this
docker info >/dev/null 2>&1 || bash "$ROOT/scripts/install_deps.sh"

# ---- 1. .env ----------------------------------------------------------------
if [[ ! -f .env ]]; then
  log "creating .env from .env.example"
  cp .env.example .env
fi

# ---- 2. Postgres (docker compose creates the container if it doesn't exist) --
log "starting postgres container (gmaps_leads_db)"
docker compose up -d db

log "waiting for postgres to be healthy..."
for i in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' gmaps_leads_db 2>/dev/null || echo starting)"
  [[ "$status" == "healthy" ]] && break
  sleep 2
  [[ $i -eq 30 ]] && die "postgres did not become healthy in 60s (docker logs gmaps_leads_db)"
done
log "postgres is healthy on localhost:5433"

# ---- 3. Python venv + deps ---------------------------------------------------
if [[ ! -x "$PY" ]]; then
  log "creating .venv and installing requirements (first run, takes a while)"
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi

# ---- 4. DB migrations --------------------------------------------------------
log "applying alembic migrations"
.venv/bin/alembic upgrade head

# ---- 5. Frontend deps --------------------------------------------------------
if [[ ! -d frontend/node_modules ]]; then
  log "installing frontend dependencies (first run)"
  (cd frontend && npm install)
fi

# ---- 6. tmux session ----------------------------------------------------------
if tmux has-session -t "$SESSION" 2>/dev/null; then
  log "tmux session '$SESSION' already running — attaching"
else
  log "launching services in tmux session '$SESSION'"
  tmux new-session  -d -s "$SESSION" -n backend  -c "$ROOT"
  tmux send-keys    -t "$SESSION:backend"  "$PY -m uvicorn app.api.main:app --reload --port 8000" C-m
  tmux new-window   -t "$SESSION" -n worker   -c "$ROOT"
  tmux send-keys    -t "$SESSION:worker"   "$PY -m app.worker poll" C-m
  tmux new-window   -t "$SESSION" -n frontend -c "$ROOT/frontend"
  tmux send-keys    -t "$SESSION:frontend" "npm run dev" C-m
  tmux select-window -t "$SESSION:backend"
fi

log "backend:  http://localhost:8000/api/health"
log "frontend: http://localhost:5173"
log "windows:  backend | worker | frontend  (Ctrl-b n/p to switch, Ctrl-b d to detach)"

# Attach only when run from an interactive terminal (not from inside tmux).
if [[ -t 1 && -z "${TMUX:-}" ]]; then
  exec tmux attach -t "$SESSION"
fi
