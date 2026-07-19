"""Unified job dispatcher.

A single worker process picks up the oldest ``pending`` job of any type
(``scrape`` | ``enrich`` | ``score``) from the ``jobs`` table and routes it to
the right handler. Running one process avoids the Botasaurus Chrome-profile
contention that two separate pollers (scraper + enricher) would cause.

Status transitions mirror the original scraper poller:
pending → running → done | failed | blocked.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.db.models import Job
from app.db.session import SessionLocal

log = logging.getLogger(__name__)


def _mark(job_id: int, status: str, *, progress: int | None = None,
          error: str | None = None) -> None:
    with SessionLocal() as session:
        job = session.get(Job, job_id)
        if not job:
            return
        job.status = status
        if progress is not None:
            job.progress = progress
        job.error = error
        if status in {"done", "failed", "blocked"}:
            job.finished_at = datetime.now(timezone.utc)
        session.commit()


def claim_next_job() -> tuple[Job | None, dict]:
    """Atomically claim the oldest pending job. Returns (detached_job, params)."""
    with SessionLocal() as session:
        job = session.scalars(
            select(Job)
            .where(Job.status == "pending")
            .order_by(Job.id)
            .limit(1)
        ).first()
        if not job:
            return None, {}
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        session.commit()
        # detach a snapshot so we can work outside the session
        job_id = job.id
        params = dict(job.params or {})
        jtype = job.type
    return Job(id=job_id, type=jtype, status="running"), params


def run_job(job: Job, params: dict) -> str:
    """Dispatch one claimed job. Returns the terminal status string."""
    jtype = job.type

    if jtype == "scrape":
        return _do_scrape(job, params)
    if jtype == "enrich":
        return _do_enrich(job, params)
    if jtype == "score":
        return _do_score(job, params)
    log.error("unknown job type %r for job %d", jtype, job.id)
    _mark(job.id, "failed", error=f"unknown job type {jtype!r}")
    return "failed"


def _do_scrape(job: Job, params: dict) -> str:
    from app.scraper.maps_task import run_query

    result = run_query(
        params.get("query", ""),
        params.get("city"),
        int(params.get("max_results", 120)),
        job_id=job.id,
    )
    if result.get("blocked"):
        _mark(job.id, "blocked", error=result.get("error"))
        return "blocked"
    if result.get("cap_reached"):
        _mark(job.id, "failed", error=result.get("error"), progress=result.get("scraped", 0))
        return "failed"
    _mark(job.id, "done", progress=result.get("scraped", 0))
    return "done"


def _do_enrich(job: Job, params: dict) -> str:
    from app.worker.enrich import run_enrich

    try:
        result = run_enrich(
            business_ids=params.get("business_ids"),
            max_n=int(params.get("max", 50)),
        )
        _mark(job.id, "done", progress=result.get("enriched", 0))
        return "done"
    except Exception as e:  # noqa: BLE001
        log.exception("enrich job %d failed", job.id)
        _mark(job.id, "failed", error=str(e)[:500])
        return "failed"


def _do_score(job: Job, params: dict) -> str:
    from app.worker.score import run_score

    try:
        result = run_score(
            business_ids=params.get("business_ids"),
            max_n=int(params.get("max", 100)),
            explain=bool(params.get("explain", False)),
        )
        _mark(job.id, "done", progress=result.get("scored", 0))
        return "done"
    except Exception as e:  # noqa: BLE001
        log.exception("score job %d failed", job.id)
        _mark(job.id, "failed", error=str(e)[:500])
        return "failed"
