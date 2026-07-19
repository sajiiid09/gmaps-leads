"""job_businesses link table (which jobs found which businesses)

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-07-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "job_businesses",
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("business_id", sa.Integer(), nullable=False),
        sa.Column(
            "found_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("job_id", "business_id"),
    )
    op.create_index("ix_job_businesses_business_id", "job_businesses", ["business_id"])
    # Backfill: link pre-existing leads to the scrape job(s) that ran the same
    # query. source_query is written verbatim from params["query"], so exact
    # match is correct; NULL source_query rows stay unlinked.
    op.execute(
        "INSERT INTO job_businesses (job_id, business_id) "
        "SELECT j.id, b.id FROM jobs j "
        "JOIN businesses b ON b.source_query = j.params->>'query' "
        "WHERE j.type = 'scrape' "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("job_businesses")
