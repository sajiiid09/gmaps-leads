# gmaps-leads

Lead-generation pipeline for scraping Google Maps businesses (Dhaka + Kerala), storing them in PostgreSQL, browsing/filtering in a React SPA, and exporting CSV.

Later phases add website enrichment (emails/socials/tech signals) and lead-fit scoring.

## Documentation

- `/home/runner/work/gmaps-leads/gmaps-leads/ARCHITECTURE.md` — system design and data flow
- `/home/runner/work/gmaps-leads/gmaps-leads/PLAN.md` — phased roadmap and current status
- `/home/runner/work/gmaps-leads/gmaps-leads/SOUL.md` — scraper operating principles (politeness + anti-breakage)

## Tech stack

- **Backend/API:** Python, FastAPI, SQLAlchemy, Alembic
- **Scraping:** Botasaurus (headful Chrome)
- **Worker:** Unified poller for scrape/enrich/score jobs
- **Frontend:** Vite + React + TypeScript
- **Database:** PostgreSQL 16 (Docker)

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker + Docker Compose
- tmux
- Google Chrome (for scraper browser mode)

## Quick start (recommended)

From repository root:

```bash
bash scripts/start_all.sh
```

What this script does:

1. Installs missing dependencies (best-effort)
2. Creates `.env` from `.env.example` if needed
3. Starts Postgres (`localhost:5433`)
4. Creates `.venv`, installs Python deps, runs Alembic migrations
5. Installs frontend deps
6. Starts backend, worker, and frontend in a `tmux` session (`gmaps-leads`)

Service URLs:

- API health: `http://localhost:8000/api/health`
- Frontend: `http://localhost:5173`

Stop everything:

```bash
bash scripts/stop_all.sh
```

## Manual setup

```bash
cd /home/runner/work/gmaps-leads/gmaps-leads
cp .env.example .env

docker compose up -d db

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
.venv/bin/alembic upgrade head

cd frontend
npm install
npm run dev
```

In another terminal:

```bash
cd /home/runner/work/gmaps-leads/gmaps-leads
.venv/bin/python -m uvicorn app.api.main:app --reload --port 8000
```

In another terminal (worker):

```bash
cd /home/runner/work/gmaps-leads/gmaps-leads
.venv/bin/python -m app.worker poll
```

## Key commands

### Scraper

```bash
# Run one query
.venv/bin/python -m app.scraper run --query "software company in Dhaka" --city Dhaka --max 120

# Selector smoke test (run before scrape sessions)
.venv/bin/python -m app.scraper smoke-test
```

### Worker

```bash
# Poll pending jobs (scrape | enrich | score)
.venv/bin/python -m app.worker poll --interval 10

# Run enrichment now
.venv/bin/python -m app.worker enrich --max 50

# Run scoring now
.venv/bin/python -m app.worker score --max 100 --explain
```

### Frontend build

```bash
cd frontend
npm run build
```

## API overview

Main API routes are mounted under `/api`:

- `GET /api/health`
- `GET /api/leads`, `GET /api/leads/{id}`, `DELETE /api/leads/{id}`
- `GET /api/export.csv`
- `POST /api/jobs`, `GET /api/jobs`
- `GET /api/enrichments`, `GET /api/scores`
- `POST /api/jobs/enrich`, `POST /api/jobs/score`
- `GET /api/settings`, `PATCH /api/settings/scrape`, queue/LLM/retry/rescore endpoints

Interactive docs:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Project rules (must-follow)

- `reference/` is **read-only inspiration**. Do not import/copy/modify files there.
- Keep **all Google Maps selectors only** in `app/scraper/selectors.py`.
- Keep politeness limits in config (`.env` → `app/config.py`) and never hardcode bypasses.
- Use `.venv/bin/python` and `.venv/bin/pip` (no global Python installs).
- LLM integration must use configurable `LLM_BASE_URL` and OpenAI-compatible client wiring.
