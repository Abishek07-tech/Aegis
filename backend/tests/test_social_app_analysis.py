from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Candidate, Investigation, RiskFinding
from app.social_app_analysis import analyze_social_app_candidate


def test_social_name_only_candidate_stays_unknown():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        investigation = Investigation(user_id="u", company_name="Acme")
        db.add(investigation)
        db.flush()
        candidate = Candidate(
            investigation_id=investigation.id, asset_type="social", platform="linkedin",
            name="Acme", url="https://linkedin.com/company/acme", discovered_from="searxng",
            status="UNKNOWN", fingerprint="social-1",
        )
        db.add(candidate)
        db.flush()
        status, score = analyze_social_app_candidate(db, investigation, candidate)
        assert status == "UNKNOWN"
        assert score is None
        assert db.scalar(__import__("sqlalchemy").select(RiskFinding).where(RiskFinding.candidate_id == candidate.id)) is None


def test_app_recruitment_payment_evidence_creates_finding():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        investigation = Investigation(user_id="u", company_name="Acme")
        db.add(investigation)
        db.flush()
        candidate = Candidate(
            investigation_id=investigation.id, asset_type="app", platform="google_play",
            name="Acme Careers", package_id="com.other.jobs", url="https://play.google.com/store/apps/details?id=com.other.jobs",
            description="Pay processing fee via WhatsApp for guaranteed job placement", discovered_from="searxng",
            status="UNKNOWN", fingerprint="app-1",
        )
        db.add(candidate)
        db.flush()
        status, score = analyze_social_app_candidate(db, investigation, candidate)
        assert status in {"REVIEW", "SUSPICIOUS", "HIGH_RISK"}
        assert score is not None
        assert candidate.findings
