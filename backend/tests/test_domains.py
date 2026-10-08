from app.domains import generate_domain_candidates


def test_dnstwist_generates_bounded_real_candidates():
    candidates = generate_domain_candidates("https://example.com", max_candidates=12)
    assert candidates
    assert len(candidates) <= 12
    assert all(item.domain != "example.com" for item in candidates)
    assert all(item.fingerprint for item in candidates)
