import pytest

from app.url_safety import UnsafeUrl, normalize_public_url


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/",
    "http://localhost/",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/",
    "file:///etc/passwd",
])
def test_private_and_non_http_urls_are_blocked(url):
    with pytest.raises(UnsafeUrl):
        normalize_public_url(url, resolve=False)


def test_url_is_normalized():
    assert normalize_public_url("HTTPS://Example.COM", resolve=False) == "https://example.com/"
