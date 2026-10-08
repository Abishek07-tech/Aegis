from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0002_ai_analysis"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if inspect(op.get_bind()).has_table("ai_analyses"):
        return
    op.create_table(
        "ai_analyses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("investigation_id", sa.String(36), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("candidate_id", sa.String(36), sa.ForeignKey("candidates.id", ondelete="SET NULL")),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("classification", sa.String(32)),
        sa.Column("confidence", sa.Float),
        sa.Column("priority", sa.String(20)),
        sa.Column("summary", sa.Text),
        sa.Column("supporting_evidence_ids", sa.JSON, nullable=False),
        sa.Column("contradicting_evidence_ids", sa.JSON, nullable=False),
        sa.Column("recommendation", sa.Text),
        sa.Column("requires_human_review", sa.Boolean),
        sa.Column("prompt_version", sa.String(40), nullable=False),
        sa.Column("evidence_hash", sa.String(64)),
        sa.Column("error", sa.Text),
        sa.Column("raw_response", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ai_analyses_investigation_id", "ai_analyses", ["investigation_id"])
    op.create_index("ix_ai_analyses_candidate_id", "ai_analyses", ["candidate_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_analyses_candidate_id", table_name="ai_analyses")
    op.drop_index("ix_ai_analyses_investigation_id", table_name="ai_analyses")
    op.drop_table("ai_analyses")
