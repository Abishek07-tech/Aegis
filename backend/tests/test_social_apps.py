from app.social_apps import InstagramCollector, candidate_fingerprint, instagram_state, parse_play_result, parse_public_profile
from app.sources import SourceState


def test_instagram_unavailable_is_explicit_when_optional_collector_missing():
    assert instagram_state() in {SourceState.REAL, SourceState.NOT_CONFIGURED}


def test_profile_and_play_parsing_never_invents_missing_fields():
    profile = parse_public_profile("linkedin", "https://linkedin.com/company/acme", "Acme", "Public page")
    assert profile.username == "company"
    app = parse_play_result("https://play.google.com/store/apps/details?id=com.acme.app", "Acme App", None)
    assert app.package_id == "com.acme.app"
    assert app.developer is None
    assert candidate_fingerprint("app", "com.acme.app") == candidate_fingerprint("app", "COM.ACME.APP")


def test_instagram_invalid_profile_is_failed_without_network_access():
    result = InstagramCollector().collect("https://instagram.com/")
    assert result.state == SourceState.FAILED
