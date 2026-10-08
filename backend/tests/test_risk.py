from app.risk import calculate_risk


def test_risk_is_deterministic_and_explainable():
    signals = {"domain_similarity": 0.94, "payment_indicator": 1.0}
    first = calculate_risk(signals)
    second = calculate_risk(signals)
    assert first == second
    assert first[0] == 39
    assert {item["name"] for item in first[3]} == {"domain_similarity", "payment_indicator"}


def test_legitimate_relationship_reduces_score_without_erasing_evidence():
    score, confidence, severity, signals = calculate_risk({"domain_similarity": 1.0}, legitimate_relationship=1.0)
    assert score == 10
    assert confidence == 37
    assert severity == "LOW"
    assert signals
