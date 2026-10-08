from dataclasses import dataclass

WEIGHTS = {
    "domain_similarity": 20,
    "visual_similarity": 18,
    "recruitment_indicator": 20,
    "payment_indicator": 20,
    "no_official_relationship": 10,
    "suspicious_external_link": 10,
    "recruitment_indicator": 20,
    "payment_indicator": 20,
    "suspicious_contact_indicator": 10,
    "username_similarity": 12,
    "social_description_similarity": 12,
    "app_name_similarity": 12,
    "package_similarity": 12,
    "developer_similarity": 12,
    "cross_platform_corroboration": 8,
}


@dataclass(frozen=True)
class Signal:
    name: str
    value: float
    weight: int
    contribution: float


def calculate_risk(signals: dict[str, float], legitimate_relationship: float = 0.0) -> tuple[int, int, str, list[dict]]:
    contributions: list[Signal] = []
    for name, weight in WEIGHTS.items():
        value = max(0.0, min(1.0, signals.get(name, 0.0)))
        contribution = value * weight
        contributions.append(Signal(name, value, weight, contribution))
    score = max(0.0, min(100.0, sum(item.contribution for item in contributions) - legitimate_relationship * 10))
    evidence_count = sum(1 for item in contributions if item.value > 0)
    confidence = min(100, 25 + evidence_count * 12)
    severity = "LOW" if score < 25 else "REVIEW" if score < 50 else "SUSPICIOUS" if score < 75 else "HIGH_RISK"
    return round(score), confidence, severity, [item.__dict__ for item in contributions if item.value > 0]
