import httpx
import pytest

from app.sources import SearxngClient, SourceState


@pytest.mark.anyio
async def test_searxng_parses_results_and_bounds_count():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search"
        assert request.url.params["format"] == "json"
        return httpx.Response(200, json={"results": [
            {"url": "https://official.example", "title": "Official", "content": "Company"},
            {"url": "https://second.example", "title": "Second", "content": "Other"},
        ]})

    result = await SearxngClient("http://search", max_results=1, transport=httpx.MockTransport(handler)).search("brand official")
    assert result.state == SourceState.REAL
    assert len(result.results) == 1


@pytest.mark.anyio
async def test_searxng_failure_states_are_not_empty_success():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "disabled"})

    result = await SearxngClient("http://search", transport=httpx.MockTransport(handler)).search("brand")
    assert result.state == SourceState.BLOCKED
    assert result.results == []


@pytest.mark.anyio
async def test_searxng_not_configured_is_explicit():
    result = await SearxngClient(None).search("brand")
    assert result.state == SourceState.NOT_CONFIGURED
    assert result.error
