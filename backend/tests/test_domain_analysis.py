from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.domain_analysis import analyze_domain_candidate
from app.models import Candidate, Investigation
from app.sources import SourceState
from app.website import WebsiteMetadata, WebsiteResponse


class DnsNoRecord:
    def analyze(self, domain):
        from app.dns_analysis import DnsResponse
        return DnsResponse(domain, SourceState.REAL, {}, no_record=True)


def test_dns_only_candidate_stays_unknown_without_finding():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        investigation = Investigation(user_id="u", company_name="Acme", official_website="https://acme.example")
        db.add(investigation)
        db.flush()
        candidate = Candidate(
            investigation_id=investigation.id, asset_type="domain", platform="web",
            name="Acme", url="https://acme.example/", domain="acme.example",
            discovered_from="dnstwist", status="UNKNOWN", fingerprint="f",
        )
        db.add(candidate)
        db.flush()
        status, score = analyze_domain_candidate(db, investigation, candidate, DnsNoRecord())
        assert status == "UNKNOWN"
        assert score is None
        assert not candidate.findings


class DnsAnswer:
    def analyze(self, domain):
        from app.dns_analysis import DnsResponse
        return DnsResponse(domain, SourceState.REAL, {"A": ["203.0.113.10"]})


class WebsiteAnswer:
    async def collect(self, url):
        return WebsiteResponse(
            SourceState.REAL,
            WebsiteMetadata(
                final_url=url,
                status_code=200,
                title="Acme Careers",
                description="Pay a registration fee for guaranteed placement. Contact us on WhatsApp.",
                canonical_url=None,
                links=[],
                careers_links=["https://acme.example/jobs"],
                visible_text="registration fee guaranteed placement WhatsApp UPI",
                redirect_chain=[],
            ),
        )


def test_recruitment_and_payment_evidence_creates_explainable_finding():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        investigation = Investigation(user_id="u", company_name="Acme", official_website="https://acme.example")
        db.add(investigation)
        db.flush()
        candidate = Candidate(
            investigation_id=investigation.id, asset_type="domain", platform="web",
            name="Acme", url="https://acme-careers.example/", domain="acme-careers.example",
            discovered_from="dnstwist", status="UNKNOWN", fingerprint="g",
        )
        db.add(candidate)
        db.flush()
        status, score = analyze_domain_candidate(db, investigation, candidate, DnsAnswer(), WebsiteAnswer())
        db.commit()
        assert status in {"REVIEW", "SUSPICIOUS", "HIGH_RISK"}
        assert score is not None
        assert candidate.findings[0].signals_json
        assert any(item["name"] == "payment_indicator" for item in candidate.findings[0].signals_json)
