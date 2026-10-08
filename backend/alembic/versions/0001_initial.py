from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table("users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("username", sa.String(120), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_table("investigations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("official_website", sa.String(2048)),
        sa.Column("official_email_domain", sa.String(255)),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("overall_risk_score", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)))
    op.create_table("scan_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("investigation_id", sa.String(36), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("progress", sa.Integer, nullable=False),
        sa.Column("error", sa.Text),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)))
    op.create_table("official_assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("investigation_id", sa.String(36), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_type", sa.String(40), nullable=False),
        sa.Column("platform", sa.String(40)),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("identifier", sa.String(255)),
        sa.Column("source", sa.String(80), nullable=False),
        sa.Column("confidence", sa.Integer, nullable=False),
        sa.Column("verified", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_table("candidates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("investigation_id", sa.String(36), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_type", sa.String(40), nullable=False),
        sa.Column("platform", sa.String(40)),
        sa.Column("name", sa.String(255)),
        sa.Column("username", sa.String(255)),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("domain", sa.String(255)),
        sa.Column("package_id", sa.String(255)),
        sa.Column("developer", sa.String(255)),
        sa.Column("description", sa.Text),
        sa.Column("discovered_from", sa.String(80), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_table("official_relationships",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("investigation_id", sa.String(36), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_asset_id", sa.String(36), sa.ForeignKey("official_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_asset_id", sa.String(36), sa.ForeignKey("official_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_type", sa.String(40), nullable=False),
        sa.Column("confidence", sa.Integer, nullable=False),
        sa.Column("source", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_table("evidence",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("candidate_id", sa.String(36), sa.ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evidence_type", sa.String(60), nullable=False),
        sa.Column("source_url", sa.String(2048)),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("score", sa.Integer),
        sa.Column("metadata_json", sa.JSON, nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_table("risk_findings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("investigation_id", sa.String(36), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("candidate_id", sa.String(36), sa.ForeignKey("candidates.id", ondelete="SET NULL")),
        sa.Column("category", sa.String(60), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("risk_score", sa.Integer, nullable=False),
        sa.Column("confidence", sa.Integer, nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("explanation", sa.Text, nullable=False),
        sa.Column("recommendation", sa.Text, nullable=False),
        sa.Column("signals_json", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_table("scan_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("scan_job_id", sa.String(36), sa.ForeignKey("scan_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stage", sa.String(60), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("progress", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_table("source_results",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("investigation_id", sa.String(36), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(80), nullable=False),
        sa.Column("query", sa.Text, nullable=False),
        sa.Column("url", sa.String(2048)),
        sa.Column("title", sa.String(500)),
        sa.Column("snippet", sa.Text),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("error", sa.Text),
        sa.Column("collector", sa.String(80), nullable=False),
        sa.Column("collector_version", sa.String(40), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), server_default=sa.func.now()))

def downgrade() -> None:
    op.drop_table("source_results")
    op.drop_table("scan_events")
    op.drop_table("risk_findings")
    op.drop_table("evidence")
    op.drop_table("official_relationships")
    op.drop_table("candidates")
    op.drop_table("official_assets")
    op.drop_table("scan_jobs")
    op.drop_table("investigations")
    op.drop_table("users")
