from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Job

router = APIRouter()


class JobCreate(BaseModel):
    query: str = Field(min_length=3, max_length=200)
    city: str | None = None
    max_results: int = Field(default=120, ge=1, le=500)


def _serialize(j: Job) -> dict:
    return {
        "id": j.id,
        "type": j.type,
        "params": j.params,
        "status": j.status,
        "progress": j.progress,
        "error": j.error,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "finished_at": j.finished_at.isoformat() if j.finished_at else None,
    }


@router.post("/jobs", status_code=201)
def create_job(body: JobCreate, db: Session = Depends(get_db)):
    job = Job(
        type="scrape",
        params={
            "query": body.query,
            "city": body.city,
            "max_results": body.max_results,
        },
    )
    db.add(job)
    db.commit()
    return _serialize(job)


@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db), limit: int = 50):
    rows = db.scalars(select(Job).order_by(Job.id.desc()).limit(limit)).all()
    return {"items": [_serialize(j) for j in rows]}


@router.delete("/jobs/{job_id}/data")
def delete_job_data(job_id: int, db: Session = Depends(get_db)):
    """Delete leads found only by this job; shared leads just lose the link.

    The job row itself is kept as history.
    """
    if not db.get(Job, job_id):
        raise HTTPException(404, "job not found")
    deleted = db.execute(
        text(
            "DELETE FROM businesses b "
            "USING job_businesses jb "
            "WHERE jb.business_id = b.id AND jb.job_id = :job_id "
            "AND NOT EXISTS (SELECT 1 FROM job_businesses o "
            "WHERE o.business_id = b.id AND o.job_id <> :job_id)"
        ),
        {"job_id": job_id},
    ).rowcount
    # links to shared leads (exclusive ones already cascaded away)
    unlinked = db.execute(
        text("DELETE FROM job_businesses WHERE job_id = :job_id"),
        {"job_id": job_id},
    ).rowcount
    db.commit()
    return {"deleted_leads": deleted, "unlinked_shared": unlinked}
