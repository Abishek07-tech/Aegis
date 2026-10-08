from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.identity import add_first_party_identity
from app.models import Investigation
from app.website import WebsiteMetadata


def test_first_party_links_create_verified_assets():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db_session = Session(engine)
    investigation = Investigation(user_id="user", company_name="Acme")
    db_session.add(investigation)
    db_session.flush()
    metadata = WebsiteMetadata(
        final_url="https://acme.example/",
        status_code=200,
        title="Acme",
        description=None,
        canonical_url=None,
        social_links=["https://instagram.com/acme", "https://x.com/acme"],
        links=[],
        careers_links=[],
        email_domains=[],
        visible_text="",
        redirect_chain=[],
    )
    assets = add_first_party_identity(db_session, investigation, metadata)
    db_session.commit()
    assert len(assets) == 3
    assert all(asset.verified for asset in assets)
