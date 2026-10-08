import httpx
import pytest

from app.sources import SourceState
from app.website import WebsiteCollector


@pytest.mark.anyio
async def test_website_collector_extracts_provenance_fields():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            content=b"""<html><head><title>Brand</title>
            <meta name='description' content='Official site'>
            <link rel='canonical' href='https://example.org/home'></head>
            <body>Contact security@example.org <a href='https://instagram.com/brand'>Social</a>
            <a href='/careers'>Careers</a></body></html>""",
        )

    response = await WebsiteCollector(transport=httpx.MockTransport(handler)).collect("https://example.org")
    assert response.state == SourceState.REAL
    assert response.metadata
    assert response.metadata.title == "Brand"
    assert response.metadata.email_domains == ["example.org"]
    assert response.metadata.social_links == ["https://instagram.com/brand"]


@pytest.mark.anyio
async def test_website_collector_blocks_private_redirect():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://127.0.0.1/admin"})

    response = await WebsiteCollector(transport=httpx.MockTransport(handler)).collect("https://example.org")
    assert response.state == SourceState.BLOCKED
    assert response.error and "Redirect blocked" in response.error
