import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Business, Enrichment, JobBusiness, Score

router = APIRouter()

SORTABLE = {"name", "rating", "reviews_count", "scraped_at", "city", "main_category"}

# Core lead columns (default export set). Extra columns are appended when the
# corresponding include_* flag is set on /api/export.csv.
CSV_BASE_COLUMNS = [
    "id", "name", "main_category", "address", "city", "phone",
    "website", "rating", "reviews_count", "source_query", "scraped_at",
]
CSV_SCORE_COLUMNS = ["score", "has_llm_summary"]
CSV_ENRICH_COLUMNS = ["emails", "socials", "tech_stack"]
ALL_CSV_COLUMNS = set(CSV_BASE_COLUMNS + CSV_SCORE_COLUMNS + CSV_ENRICH_COLUMNS)


def _filtered_query(
    city: str | None,
    category: str | None,
    has_website: bool | None,
    has_phone: bool | None,
    min_rating: float | None,
    search: str | None,
    source_query: str | None = None,
    job_id: int | None = None,
) -> Select:
    q = select(Business)
    if job_id is not None:
        # one link row max per (job, business) — join cannot duplicate rows
        q = q.join(JobBusiness, JobBusiness.business_id == Business.id).where(
            JobBusiness.job_id == job_id
        )
    if source_query:
        q = q.where(Business.source_query.ilike(source_query))
    if city:
        q = q.where(Business.city.ilike(city))
    if category:
        q = q.where(Business.main_category.ilike(f"%{category}%"))
    if has_website is not None:
        q = q.where(
            Business.website.is_not(None) if has_website else Business.website.is_(None)
        )
    if has_phone is not None:
        q = q.where(
            Business.phone.is_not(None) if has_phone else Business.phone.is_(None)
        )
    if min_rating is not None:
        q = q.where(Business.rating >= min_rating)
    if search:
        pattern = f"%{search}%"
        q = q.where(
            or_(Business.name.ilike(pattern), Business.address.ilike(pattern))
        )
    return q


def _serialize(b: Business) -> dict:
    return {
        "id": b.id,
        "place_key": b.place_key,
        "name": b.name,
        "main_category": b.main_category,
        "categories": b.categories,
        "address": b.address,
        "city": b.city,
        "phone": b.phone,
        "website": b.website,
        "rating": b.rating,
        "reviews_count": b.reviews_count,
        "socials": b.socials,
        "source_query": b.source_query,
        "scraped_at": b.scraped_at.isoformat() if b.scraped_at else None,
    }


@router.get("/leads")
def list_leads(
    db: Session = Depends(get_db),
    city: str | None = None,
    category: str | None = None,
    has_website: bool | None = None,
    has_phone: bool | None = None,
    min_rating: float | None = None,
    search: str | None = None,
    job_id: int | None = None,
    sort: str = "scraped_at",
    order: str = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    q = _filtered_query(
        city, category, has_website, has_phone, min_rating, search, job_id=job_id
    )
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    if sort not in SORTABLE:
        sort = "scraped_at"
    col = getattr(Business, sort)
    q = q.order_by(col.desc().nulls_last() if order == "desc" else col.asc().nulls_last())
    rows = db.scalars(q.offset((page - 1) * page_size).limit(page_size)).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_serialize(b) for b in rows],
    }


@router.get("/leads/{lead_id}")
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    b = db.get(Business, lead_id)
    if not b:
        raise HTTPException(404, "lead not found")
    return _serialize(b)


@router.delete("/leads/{lead_id}")
def delete_lead(lead_id: int, db: Session = Depends(get_db)):
    b = db.get(Business, lead_id)
    if not b:
        raise HTTPException(404, "lead not found")
    db.delete(b)  # enrichment/score/job links cascade
    db.commit()
    return {"deleted": lead_id}


@router.get("/export.csv")
def export_csv(
    db: Session = Depends(get_db),
    city: str | None = None,
    category: str | None = None,
    has_website: bool | None = None,
    has_phone: bool | None = None,
    min_rating: float | None = None,
    search: str | None = None,
    job_id: int | None = None,
    columns: str | None = None,
    include_score: bool = False,
    include_enrichment: bool = False,
):
    q = _filtered_query(
        city, category, has_website, has_phone, min_rating, search, job_id=job_id
    )
    q = q.order_by(Business.name.asc())

    # Resolve the column set: explicit ?columns= wins; otherwise base + flags.
    if columns:
        chosen = [c.strip() for c in columns.split(",") if c.strip() in ALL_CSV_COLUMNS]
        if not chosen:
            chosen = list(CSV_BASE_COLUMNS)
    else:
        chosen = list(CSV_BASE_COLUMNS)
        if include_score:
            chosen += [c for c in CSV_SCORE_COLUMNS if c not in chosen]
        if include_enrichment:
            chosen += [c for c in CSV_ENRICH_COLUMNS if c not in chosen]

    need_score = bool(set(chosen) & set(CSV_SCORE_COLUMNS))
    need_enrich = bool(set(chosen) & set(CSV_ENRICH_COLUMNS))

    def _cell(b, s, e, col: str) -> str:
        if col == "score":
            return s.score if s and s.score is not None else ""
        if col == "has_llm_summary":
            return "yes" if (s and s.llm_summary) else "no"
        if col == "emails":
            return "; ".join(e.emails) if (e and e.emails) else ""
        if col == "socials":
            return "; ".join(f"{k}:{v}" for k, v in (e.socials or {}).items()) if e else ""
        if col == "tech_stack":
            return "; ".join(e.tech_stack) if (e and e.tech_stack) else ""
        # base column on the business row
        val = getattr(b, col)
        if col == "scraped_at":
            return val.isoformat() if val else ""
        return val if val is not None else ""

    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(chosen)
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        for b in db.scalars(q).yield_per(200):
            s = None
            e = None
            if need_score:
                s = db.scalar(select(Score).where(Score.business_id == b.id))
            if need_enrich:
                e = db.scalar(select(Enrichment).where(Enrichment.business_id == b.id))
            writer.writerow([_cell(b, s, e, c) for c in chosen])
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    filename = f"leads-job-{job_id}.csv" if job_id is not None else "leads.csv"
    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
