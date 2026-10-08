import asyncio
from difflib import SequenceMatcher
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from .dns_analysis import DnsAnalyzer
from .models import Candidate, Evidence, Investigation, RiskFinding
from .risk import calculate_risk
from .website import WebsiteCollector

RECRUITMENT_TERMS = ("registration fee", "interview fee", "processing fee", "training fee", "security deposit", "pay to apply", "guaranteed job", "guaranteed placement")
PAYMENT_TERMS = ("upi", "payment", "pay now", "deposit", "send money", "bank transfer")
CONTACT_TERMS = ("whatsapp", "telegram")


def _similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, left.casefold(), right.casefold()).ratio()


def _add_evidence(db: Session, candidate: Candidate, evidence_type: str, value: str, source_url: str | None, metadata: dict, score: int | None = None) -> None:
    exists = db.scalar(select(Evidence).where(
        Evidence.candidate_id == candidate.id,
        Evidence.evidence_type == evidence_type,
        Evidence.source_url == source_url,
        Evidence.value == value,
    ))
    if exists is None:
        db.add(Evidence(
            candidate_id=candidate.id,
            evidence_type=evidence_type,
            source_url=source_url,
            value=value[:20_000],
            score=score,
            metadata_json=metadata,
        ))


def analyze_domain_candidate(
    db: Session,
    investigation: Investigation,
    candidate: Candidate,
    dns_analyzer: DnsAnalyzer | None = None,
    website_collector: WebsiteCollector | None = None,
) -> tuple[str, int | None]:
    _add_evidence(
        db, candidate, "registration_status", "NOT_CONFIGURED", candidate.url,
        {"collector": "registration", "collector_version": "not-configured", "reason": "No verified RDAP/WHOIS adapter is configured"},
    )
    dns_result = (dns_analyzer or DnsAnalyzer()).analyze(candidate.domain or "")
    _add_evidence(
        db, candidate, "dns_status", dns_result.state.value, candidate.url,
        {"domain": dns_result.domain, "collector": dns_result.collector, "collector_version": dns_result.collector_version, "error": dns_result.error, "no_record": dns_result.no_record},
    )
    for record_type, values in dns_result.records.items():
        for value in values:
            _add_evidence(db, candidate, f"dns_{record_type.lower()}", value, candidate.url, {"domain": dns_result.domain, "collector": dns_result.collector, "collector_version": dns_result.collector_version})
    if dns_result.state.value != "REAL" or dns_result.no_record:
        candidate.status = "UNKNOWN"
        return candidate.status, None

    website_result = asyncio.run((website_collector or WebsiteCollector()).collect(candidate.url))
    _add_evidence(db, candidate, "website_status", website_result.state.value, candidate.url, {"collector": "website", "error": website_result.error})
    if website_result.metadata is None:
        candidate.status = "UNKNOWN"
        return candidate.status, None

    metadata = website_result.metadata
    for evidence_type, value in (
        ("page_title", metadata.title),
        ("page_description", metadata.description),
        ("redirect_chain", " -> ".join(metadata.redirect_chain)),
    ):
        if value:
            _add_evidence(db, candidate, evidence_type, value, metadata.final_url, {"collector": "website", "status_code": metadata.status_code})
    text = " ".join(filter(None, (metadata.title, metadata.description, metadata.visible_text))).casefold()
    brand_similarity = _similarity(investigation.company_name, metadata.title or metadata.visible_text[:500])
    domain_similarity = _similarity(
        (investigation.official_website or investigation.company_name).replace("https://", "").split("/")[0].split(".")[0],
        (candidate.domain or "").split(".")[0],
    )
    recruitment = float(any(term in text for term in RECRUITMENT_TERMS) or bool(metadata.careers_links))
    payment = float(any(term in text for term in PAYMENT_TERMS))
    contact = float(any(term in text for term in CONTACT_TERMS))
    official_host = urlsplit(investigation.official_website or "").hostname
    official_reference = float(bool(official_host and any(urlsplit(link).hostname == official_host for link in metadata.links)))
    signals = {
        "domain_similarity": domain_similarity,
        "visual_similarity": brand_similarity,
        "recruitment_indicator": recruitment,
        "payment_indicator": payment,
        "suspicious_contact_indicator": contact,
        "no_official_relationship": 1.0 - official_reference,
    }
    for name, value in signals.items():
        if value > 0:
            _add_evidence(db, candidate, f"signal_{name}", str(round(value, 4)), metadata.final_url, {"signal": name, "value": value})
    legitimate = official_reference
    score, confidence, severity, contributions = calculate_risk(signals, legitimate_relationship=legitimate)
    if not contributions:
        candidate.status = "UNKNOWN"
        return candidate.status, None
    candidate.status = severity
    existing = db.scalar(select(RiskFinding).where(RiskFinding.candidate_id == candidate.id))
    explanation = "Deterministic signals were observed from DNS and publicly reachable website evidence."
    recommendation = "Review the evidence and verify the domain through the official company website before taking action."
    if existing is None:
        db.add(RiskFinding(
            investigation_id=investigation.id,
            candidate_id=candidate.id,
            category="domain_impersonation",
            severity=severity,
            risk_score=score,
            confidence=confidence,
            title="Potential domain impersonation",
            explanation=explanation,
            recommendation=recommendation,
            signals_json=contributions,
        ))
    return severity, score
