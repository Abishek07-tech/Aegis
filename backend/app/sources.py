from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import httpx


class SourceState(StrEnum):
    REAL = "REAL"
    UNAVAILABLE = "UNAVAILABLE"
    NOT_CONFIGURED = "NOT_CONFIGURED"
    BLOCKED = "BLOCKED"
    RATE_LIMITED = "RATE_LIMITED"
    FAILED = "FAILED"
    DEMO = "DEMO"


@dataclass(frozen=True)
class SearchResult:
    url: str
    title: str | None
    snippet: str | None


@dataclass(frozen=True)
class SearchResponse:
    state: SourceState
    results: list[SearchResult]
    error: str | None = None
    collector: str = "searxng"
    collector_version: str = "1"


class SearxngClient:
    def __init__(
        self,
        base_url: str | None,
        *,
        timeout_seconds: float = 8.0,
        max_results: int = 20,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/") if base_url else None
        self.timeout = httpx.Timeout(timeout_seconds)
        self.max_results = max(1, min(max_results, 100))
        self.transport = transport

    async def search(self, query: str) -> SearchResponse:
        if not self.base_url:
            return SearchResponse(SourceState.NOT_CONFIGURED, [], "SEARXNG_URL is not configured")
        if not query.strip():
            return SearchResponse(SourceState.FAILED, [], "Search query must not be empty")
        try:
            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=False, transport=self.transport) as client:
                response = await client.get(
                    f"{self.base_url}/search",
                    params={"q": query.strip(), "format": "json", "pageno": 1},
                    headers={"Accept": "application/json"},
                )
        except httpx.TimeoutException:
            return SearchResponse(SourceState.UNAVAILABLE, [], "SearXNG request timed out")
        except httpx.HTTPError:
            return SearchResponse(SourceState.UNAVAILABLE, [], "SearXNG could not be reached")

        if response.status_code == 403:
            return SearchResponse(SourceState.BLOCKED, [], "SearXNG JSON output is disabled or blocked")
        if response.status_code == 429:
            return SearchResponse(SourceState.RATE_LIMITED, [], "SearXNG rate limited the request")
        if response.status_code >= 500:
            return SearchResponse(SourceState.UNAVAILABLE, [], f"SearXNG returned HTTP {response.status_code}")
        if response.status_code >= 400:
            return SearchResponse(SourceState.FAILED, [], f"SearXNG returned HTTP {response.status_code}")
        try:
            payload: Any = response.json()
        except ValueError:
            return SearchResponse(SourceState.FAILED, [], "SearXNG returned malformed JSON")
        if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
            return SearchResponse(SourceState.FAILED, [], "SearXNG response did not contain a results list")

        results: list[SearchResult] = []
        for item in payload["results"][: self.max_results]:
            if not isinstance(item, dict) or not isinstance(item.get("url"), str):
                continue
            results.append(
                SearchResult(
                    url=item["url"],
                    title=item.get("title") if isinstance(item.get("title"), str) else None,
                    snippet=item.get("content") if isinstance(item.get("content"), str) else None,
                )
            )
        return SearchResponse(SourceState.REAL, results)
