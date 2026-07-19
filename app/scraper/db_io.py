"""DB writes for the scraper: place_key derivation + idempotent upsert."""

import hashlib
import re

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.db.models import Business, JobBusiness
from app.db.session import SessionLocal

# Maps place URLs embed a stable data id like !1s0x3755b8...:0xabc...
_DATA_ID_RE = re.compile(r"0x[0-9a-f]+:0x[0-9a-f]+")


def derive_place_key(url: str | None, name: str | None, address: str | None) -> str:
    if url:
        m = _DATA_ID_RE.search(url)
        if m:
            return m.group(0)
    digest = hashlib.sha1(f"{name}|{address}".encode()).hexdigest()
    return f"sha1:{digest}"


def existing_place_key_ids() -> dict[str, int]:
    with SessionLocal() as session:
        rows = session.execute(select(Business.place_key, Business.id)).all()
        return dict(rows)


def upsert_business(record: dict) -> int:
    stmt = insert(Business).values(**record)
    update_cols = {
        k: stmt.excluded[k] for k in record if k not in ("place_key",)
    }
    stmt = stmt.on_conflict_do_update(
        index_elements=[Business.place_key], set_=update_cols
    ).returning(Business.id)
    with SessionLocal() as session:
        business_id = session.scalar(stmt)
        session.commit()
    return business_id


def link_job_business(job_id: int | None, business_id: int) -> None:
    """Record that a job found a business (job_id=None → ad-hoc run, no-op)."""
    if job_id is None:
        return
    stmt = (
        insert(JobBusiness)
        .values(job_id=job_id, business_id=business_id)
        .on_conflict_do_nothing()
    )
    with SessionLocal() as session:
        session.execute(stmt)
        session.commit()
