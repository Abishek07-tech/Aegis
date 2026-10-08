from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Candidate, Evidence, Investigation, OfficialAsset, RiskFinding
from .risk import calculate_risk

RECRUITMENT = ("recruitment", "jobs", "careers", "hiring", "interview", "placement", "job offer")
PAYMENT = ("fee", "payment", "upi", "deposit", "pay to apply", "processing")
CONTACT = ("whatsapp", "telegram")


def analyze_social_app_candidate(db: Session, investigation: Investigation, candidate: Candidate) -> tuple[str, int | None]:
    source_url = candidate.url
    text = " ".join(filter(None, (candidate.name, candidate.description))).casefold()
    _add(db, candidate, f"{candidate.platform}_profile" if candidate.asset_type == "social" else "play_app", text, source_url)
    official = db.scalar(select(OfficialAsset).where(
        OfficialAsset.investigation_id == investigation.id,
        OfficialAsset.url == candidate.url,
        OfficialAsset.verified.is_(True),
    ))
    name_similarity = SequenceMatcher(None, investigation.company_name.casefold(), (candidate.name or "").casefold()).ratio()
    recruitment = float(any(term in text for term in RECRUITMENT))
    payment = float(any(term in text for term in PAYMENT))
    contact = float(any(term in text for term in CONTACT))
    official_relationship = float(official is not None)
    signals = {
        "username_similarity": name_similarity if candidate.asset_type == "social" else 0.0,
        "social_description_similarity": name_similarity if candidate.asset_type == "social" else 0.0,
        "app_name_similarity": name_similarity if candidate.asset_type == "app" else 0.0,
        "recruitment_indicator": recruitment,
        "payment_indicator": payment,
        "suspicious_contact_indicator": contact,
        "no_official_relationship": 1.0 - official_relationship,
    }
    for name, value in signals.items():
        if value:
            _add(db, candidate, f"signal_{name}", str(round(value, 4)), source_url)
    # A name match without corroborating harmful or relationship evidence stays unknown.
    corroborating = recruitment or payment or contact
    if not corroborating and not official:
        candidate.status = "UNKNOWN"
        return candidate.status, None
    score, confidence, severity, contributions = calculate_risk(signals, legitimate_relationship=official_relationship)
    candidate.status = "LEGITIMATE" if official else severity
    if not official and contributions and db.scalar(select(RiskFinding).where(RiskFinding.candidate_id == candidate.id)) is None:
        db.add(RiskFinding(
            investigation_id=investigation.id,
            candidate_id=candidate.id,
            category="social_app_impersonation",
            severity=severity,
            risk_score=score,
            confidence=confidence,
            title="Potential social or app impersonation",
            explanation="This classification is based on stored public discovery evidence and deterministic signals.",
            recommendation="Verify the asset through the official company website before taking action.",
            signals_json=contributions,
        ))
    return candidate.status, score


def _add(db: Session, candidate: Candidate, evidence_type: str, value: str, source_url: str) -> None:
    if not value:
        return
    if db.scalar(select(Evidence).where(
        Evidence.candidate_id == candidate.id,
        Evidence.evidence_type == evidence_type,
        Evidence.source_url == source_url,
        Evidence.value == value,
    )) is None:
        db.add(Evidence(
            candidate_id=candidate.id,
            evidence_type=evidence_type,
            source_url=source_url,
            value=value[:20_000],
            metadata_json={"collector": "searxng", "discovery_only": True},
        ))
