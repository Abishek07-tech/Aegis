from dataclasses import dataclass, field
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from .sources import SourceState
from .url_safety import UnsafeUrl, normalize_public_url


@dataclass(frozen=True)
class WebsiteMetadata:
    final_url: str
    status_code: int
    title: str | None
    description: str | None
    canonical_url: str | None
    links: list[str] = field(default_factory=list)
    social_links: list[str] = field(default_factory=list)
    careers_links: list[str] = field(default_factory=list)
    email_domains: list[str] = field(default_factory=list)
    visible_text: str = ""
    redirect_chain: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class WebsiteResponse:
    state: SourceState
    metadata: WebsiteMetadata | None = None
    error: str | None = None


class WebsiteCollector:
    def __init__(
        self,
        *,
        timeout_seconds: float = 8.0,
        max_response_bytes: int = 2_000_000,
        max_redirects: int = 4,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.timeout = httpx.Timeout(timeout_seconds)
        self.max_response_bytes = max(1024, max_response_bytes)
        self.max_redirects = max(0, max_redirects)
        self.transport = transport

    async def collect(self, url: str) -> WebsiteResponse:
        try:
            current = normalize_public_url(url)
        except UnsafeUrl as exc:
            return WebsiteResponse(SourceState.BLOCKED, error=str(exc))
        redirects: list[str] = []
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=False,
                transport=self.transport,
                headers={"User-Agent": "DigitalRiskProtection/0.1 (+authorized-public-analysis)"},
            ) as client:
                for _ in range(self.max_redirects + 1):
                    response = await client.get(current)
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            return WebsiteResponse(SourceState.FAILED, error="Redirect did not include a location")
                        redirects.append(current)
                        try:
                            current = normalize_public_url(urljoin(current, location))
                        except UnsafeUrl as exc:
                            return WebsiteResponse(SourceState.BLOCKED, error=f"Redirect blocked: {exc}")
                        continue
                    if response.status_code == 429:
                        return WebsiteResponse(SourceState.RATE_LIMITED, error="Website rate limited the request")
                    if response.status_code in {401, 403}:
                        return WebsiteResponse(SourceState.BLOCKED, error=f"Website returned HTTP {response.status_code}")
                    if response.status_code >= 400:
                        return WebsiteResponse(SourceState.FAILED, error=f"Website returned HTTP {response.status_code}")
                    content_type = response.headers.get("content-type", "").lower()
                    if content_type and "html" not in content_type and "text/" not in content_type:
                        return WebsiteResponse(SourceState.FAILED, error="Response is not HTML or text")
                    body = response.content
                    if len(body) > self.max_response_bytes:
                        return WebsiteResponse(SourceState.FAILED, error="Response exceeded maximum size")
                    return WebsiteResponse(SourceState.REAL, self._extract(current, response.status_code, body, redirects))
                return WebsiteResponse(SourceState.FAILED, error="Redirect limit exceeded")
        except httpx.TimeoutException:
            return WebsiteResponse(SourceState.UNAVAILABLE, error="Website request timed out")
        except httpx.HTTPError:
            return WebsiteResponse(SourceState.UNAVAILABLE, error="Website could not be reached")

    @staticmethod
    def _extract(final_url: str, status_code: int, body: bytes, redirects: list[str]) -> WebsiteMetadata:
        soup = BeautifulSoup(body, "lxml")
        title = soup.title.get_text(" ", strip=True) if soup.title else None
        description_tag = soup.find("meta", attrs={"name": "description"})
        description = description_tag.get("content", "").strip() or None if description_tag else None
        canonical_tag = soup.find("link", attrs={"rel": lambda value: value and "canonical" in value})
        canonical = canonical_tag.get("href") if canonical_tag else None
        links: list[str] = []
        social: list[str] = []
        careers: list[str] = []
        domains: set[str] = set()
        for anchor in soup.find_all("a", href=True):
            absolute = urljoin(final_url, anchor["href"])
            if not absolute.startswith(("http://", "https://")):
                continue
            links.append(absolute)
            lowered = absolute.lower()
            if any(platform in lowered for platform in ("instagram.com", "linkedin.com", "x.com", "twitter.com", "facebook.com")):
                social.append(absolute)
            if any(term in lowered for term in ("career", "jobs", "recruit")):
                careers.append(absolute)
        for address in soup.get_text(" ", strip=True).split():
            if "@" in address and "." in address.rsplit("@", 1)[-1]:
                domains.add(address.rsplit("@", 1)[-1].strip(".,;:()[]<>").lower())
        return WebsiteMetadata(
            final_url=final_url,
            status_code=status_code,
            title=title,
            description=description,
            canonical_url=urljoin(final_url, canonical) if canonical else None,
            links=list(dict.fromkeys(links)),
            social_links=list(dict.fromkeys(social)),
            careers_links=list(dict.fromkeys(careers)),
            email_domains=sorted(domains),
            visible_text=soup.get_text(" ", strip=True)[:50_000],
            redirect_chain=redirects,
        )
