# Plan — Ship gmaps-leads as a one-click desktop bundle (Windows + macOS)

## Goal
Non-technical users download a ZIP, unzip, double-click one launcher → the full stack
(API + worker/scraper + SPA) runs locally and the browser opens. Works on Windows and macOS.
Scraping runs on the user's own machine/IP (full scrape + view).

## Locked decisions (from planning interview)
1. **Scope**: full scrape + view — bundle includes the worker + Botasaurus Chrome.
2. **Database**: swap to **SQLite** for the bundle (a local `.db` file). Keep Postgres usable for dev.
3. **Build**: **GitHub Actions** matrix (`windows-latest` + `macos-latest`), tag-triggered, uploads a per-platform ZIP to the release.
4. **Form**: a zipped folder + a double-click launcher (`gmaps-leads.exe` on Windows; `Start Mac.command` on macOS).

## Hard constraints discovered in code
- **PyInstaller cannot cross-compile** → Windows build must run on Windows (CI does this).
- `app/api/main.py` only mounts `/api*`; it does **not** serve the SPA. Must add a static mount + history fallback.
- SPA already calls **relative** `/api/...` (no origin hardcoded) → same-origin serving works for free.
- `requirements.txt` pins `uvloop` and `PyVirtualDisplay` (unix-only) → will break Windows `pip install`. Gate behind `sys_platform != 'win32'` markers.
- Postgres-specific code (4 upserts + 1 json func + `JSONB` columns) must become dialect-aware so SQLite works while Postgres dev still works.

---

## Phase 1 — Make the app SQLite-capable (keep Postgres for dev)

Goal: same code runs on Postgres (dev) or SQLite (bundle); the launcher chooses via `DATABASE_URL`.

- **`app/db/models.py`**: replace `from sqlalchemy.dialects.postgresql import JSONB` with `from sqlalchemy import JSON`; change all `JSONB` → `JSON`. (Generic `JSON` reads/writes the existing PG `jsonb` columns fine and maps to TEXT on SQLite.)
- **Dialect-aware upsert helper** (new `app/db/upsert.py`): returns a statement built with `postgresql.insert` or `sqlite.insert` based on `engine.dialect.name`. Used by:
  - `app/scraper/db_io.py` (Business upsert)
  - `app/worker/enrich.py` (Enrichment upsert)
  - `app/worker/score.py` (Score upsert)
  - `app/config.py::update_runtime_config` (RuntimeConfig upsert)
  - In each, swap `from sqlalchemy.dialects.postgresql import insert` for the helper.
- **`app/api/enrichment.py`**: `func.jsonb_array_length(...)` → dialect-aware: `jsonb_array_length` on PG, `json_array_length` on SQLite (small helper).
- **`app/db/session.py`**: `create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)`. If dialect is sqlite, pass `connect_args={"check_same_thread": False}` (FastAPI + worker share the process). Keep default empty dict for PG.
- **`app/config.py`**: leave default `database_url` as the Postgres URL (dev). The bundle launcher overrides via `DATABASE_URL=sqlite:///<user_data_dir>/gmaps-leads.db`.
- **Schema bootstrap for the bundle**: add `app/db/bootstrap.py::ensure_schema()` that runs `Base.metadata.create_all(engine)` when the target tables are absent. The bundled supervisor calls this on first launch instead of Alembic (Alembic migrations are Postgres-authored and will not run on SQLite). Alembic remains the dev-only migration tool.

**Validation P1**: `DATABASE_URL=sqlite:///./test.db .venv/bin/python -c "from app.db.bootstrap import ensure_schema; ensure_schema()"` creates all tables; then run `python -m app.scraper --smoke-test` and confirm an upsert round-trips into SQLite with no dupes; hit `/api/leads` and `/api/export.csv`.

---

## Phase 2 — Serve the built SPA from FastAPI (prod mode)

- **`frontend/`**: `npm run build` → `frontend/dist/` (already green per PLAN.md).
- **`app/api/main.py`**:
  - Add `app.mount("/", StaticFiles(directory=spa_dir, html=True), name="spa")` **last** (after `/api` routers), where `spa_dir` resolves to `frontend/dist` (dev/repo) or the bundled location (frozen; see Phase 4 `sys._MEIPASS`).
  - Add a catch-all `@app.get("/{full_path:path}")` that returns `index.html` for unknown non-`/api` paths (client-side routing fallback) — placed before the static mount, or let `html=True` handle it.
  - Broaden CORS to also allow same-origin (harmless) or leave as-is; not blocking since same-origin needs no CORS.
- **No frontend code changes required** (relative URLs already in place). `vite.config.ts` proxy stays for dev only.

**Validation P2**: `uvicorn app.api.main:app --port 8000`; open `http://localhost:8000` → SPA loads, leads table renders, export works, all without the Vite dev server.

---

## Phase 3 — Supervisor entry script (one process spawns API + worker + browser)

New `run.py` at repo root (the PyInstaller entry point). Modes:

- `python run.py` (no arg) → **supervisor**:
  1. `ensure_schema()` (SQLite bootstrap, idempotent).
  2. Spawn the **worker** as a child process: `subprocess.Popen([sys.executable, "--worker"], env={... DATABASE_URL ...})`.
  3. Pick a free port (start at 8000, increment if busy) so the app never fails to start on a taken port.
  4. Open the browser to `http://127.0.0.1:<port>` after ~1.5s (thread).
  5. Run `uvicorn.run(app, host="127.0.0.1", port=<port>)` in the main thread.
  6. On exit (Ctrl-C / window close): terminate the worker subprocess.
- `python run.py --worker` → import and run the worker poll loop directly (no `-m`, which doesn't work frozen).
  - Requires a tiny refactor: extract the body of `app/worker/__main__.py` `poll` command into a callable `app/worker/dispatch.py::run_poll_loop()` so both `python -m app.worker poll` (dev) and `run.py --worker` (bundle) call the same function.

Environment: the supervisor sets `DATABASE_URL` (sqlite path in user data dir), and forwards `LLM_*`/scrape knobs from a bundled `config.env` if present.

**Data dir**: writable, per-user, outside the (possibly read-only) bundle:
- Windows: `%APPDATA%/gmaps-leads/` (db file, logs, botasaurus profile/cache).
- macOS: `~/Library/Application Support/gmaps-leads/`.
- Point Botasaurus/Chromium user-data + cache to this dir so first-run Chromium download and profile writes succeed.

**Validation P3**: `python run.py` boots, worker subprocess logs "polling", browser opens SPA, a UI-triggered scrape job is picked up by the worker and rows appear. Ctrl-C cleanly stops both.

---

## Phase 4 — PyInstaller spec + requirements markers

- **`requirements.txt`**: add PEP 508 markers so Windows CI install succeeds:
  - `uvloop==0.22.1; sys_platform != 'win32'`
  - `PyVirtualDisplay==3.0; sys_platform != 'win32'`
  - (Recheck `httptools`, `psutil` — keep; both ship Windows wheels. Keep `psycopg`/`psycopg-binary`; they install on Windows and are unused by the bundle.)
  - Add `pyinstaller` to a separate `requirements-build.txt` (not the runtime set).
- **`gmaps-leads.spec`** (PyInstaller, one-folder mode — NOT one-file):
  - `entry = 'run.py'`, `name = 'gmaps-leads'`.
  - `datas`: include the built SPA → `('frontend/dist', 'frontend/dist')`.
  - Resolve `spa_dir` in `main.py` as: frozen → `os.path.join(sys._MEIPASS, 'frontend', 'dist')`; else repo `frontend/dist`.
  - `hiddenimports` + `collect_all` for the heavy/non-introspectable packages (iterate until smoke run works):
    - `botasaurus`, `botasaurus_driver`, `bota`, `botasaurus_requests`, `botasaurus_api`, `botasaurus_proxy_authentication`, `botasaurus_humancursor`, `close_chrome`, `javascript_fixes`
    - `gevent`, `uvicorn` (protocols/logging), `numpy`, `lxml`, `openai`, `sqlalchemy.dialects.sqlite`
  - `console=True` (keep a visible log window so users see it's running and can close it to stop).
  - macOS: produce the unix executable (`.app` is optional polish later).

**Risk note**: PyInstaller + botasaurus/gevent is the single highest-risk area. Expect iteration with `--collect-all`/hiddenimports; validate by running a real smoke scrape inside the frozen bundle on each OS.

**Validation P4**: `pyinstaller gmaps-leads.spec` on the dev OS; run `dist/gmaps-leads/gmaps-leads` (or `.exe`); confirm SPA loads, a job runs, Chrome launches.

---

## Phase 5 — Launcher scripts (the double-click target)

- **Windows** `start.bat` next to the exe: sets `cwd` to script dir, launches `gmaps-leads.exe`. (The exe itself is also directly double-clickable; the bat guarantees correct working dir.)
- **macOS** `Start Mac.command`: `#!/bin/bash`, `cd "$(dirname "$0")"`, `./gmaps-leads`. CI `chmod +x` it.
- Include a short `README.txt` ("unzip, double-click start, first launch downloads Chrome ~150MB, requires internet").
- First-run note: Botasaurus auto-downloads Chromium into the writable data dir.

---

## Phase 6 — GitHub Actions release workflow

`.github/workflows/release.yml`:
- **Trigger**: push tag `v*`.
- **Matrix**: `os: [windows-latest, macos-latest]`; `python-version: '3.12'` (match the dev venv).
- **Steps** per OS:
  1. checkout
  2. setup-python, setup-node
  3. `pip install -r requirements.txt -r requirements-build.txt`
  4. `cd frontend && npm ci && npm run build`
  5. `pyinstaller gmaps-leads.spec`
  6. Stage `dist/gmaps-leads/` + launcher scripts + `README.txt` into a folder, then zip:
     - Windows: `Compress-Archive`
     - macOS: `zip -r` (preserve `+x` bits)
  7. `softprops/action-gh-release` to attach `gmaps-leads-windows.zip` / `gmaps-leads-mac.zip`.
- **Artifacts** also uploaded on every workflow run (for testing without tagging).

**Validation P6**: push a `v0.0.1-test` tag; confirm both ZIPs appear on the release; download the Mac ZIP on this machine, unzip, run, confirm end-to-end; have the Windows ZIP run on a Windows machine (or a teammate).

---

## Risks / open items (call out, do not block)
- **Antivirus / SmartScreen / Gatekeeper (unsigned)**: non-technical users will see warnings on unsigned binaries.
  - Windows SmartScreen: "More info → Run anyway."
  - macOS: right-click → Open (or `xattr -d com.apple.quarantine`).
  - Optional polish: code-signing cert (Windows) and Apple Developer notarization (macOS, ~$99/yr) + a notarize CI step. **Out of scope for v1** unless requested.
- **First-run Chromium download** (~150MB) needs internet and can trip AV. Mitigated by writable data dir + README note.
- **PyInstaller + botasaurus/gevent** may need extra `collect_all`/hooks; budget iteration time and validate via smoke scrape in the frozen build.
- **uvloop** is unix-only — markers above prevent the Windows install from failing.
- **Botasaurus headful Chrome on Windows** may require VC++ redistributables on very old Windows installs; note in README.
- Each end user scrapes from their **own residential IP** — by design (their decision), but they bear any IP-challenge/CAPTCHA risk; politeness knobs already exist in Settings.

## Out of scope
- Code-signing / notarization (v1 ships unsigned with clear instructions).
- Windows installer (Inno Setup) or macOS `.app`/DMG polish (can follow if desired).
- Auto-update mechanism.
- Remote/shared-DB topology (covered separately by Phase 7 VPS plan).
