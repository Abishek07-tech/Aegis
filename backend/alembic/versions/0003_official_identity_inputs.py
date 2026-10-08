from alembic import op
import sqlalchemy as sa

revision = "0003_official_identity_inputs"
down_revision = "0002_ai_analysis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column, definition in (
        ("official_instagram", sa.String(2048)),
        ("official_facebook", sa.String(2048)),
        ("official_linkedin", sa.String(2048)),
        ("official_x", sa.String(2048)),
        ("other_official_information", sa.Text()),
    ):
        op.add_column("investigations", sa.Column(column, definition, nullable=True))
    op.add_column("official_assets", sa.Column("verification_status", sa.String(32), nullable=False, server_default="UNKNOWN"))
    op.add_column("official_assets", sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    op.drop_column("official_assets", "metadata_json")
    op.drop_column("official_assets", "verification_status")
    for column in ("other_official_information", "official_x", "official_linkedin", "official_facebook", "official_instagram"):
        op.drop_column("investigations", column)
