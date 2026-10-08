from dataclasses import dataclass
from hashlib import sha256
from importlib.util import find_spec
from urllib.parse import parse_qs, urlsplit

from .sources import SearchResponse, SourceState


@dataclass(frozen=True)
class ProfileData:
    platform: str
    url: str
    username: str | None
    name: str | None
    description: str | None
    external_links: list[str]
    state: SourceState
    error: str | None = None


@dataclass(frozen=True)
class AppData:
    url: str
    app_name: str | None
    package_id: str | None
    developer: str | None
    description: str | None
    icon_url: str | None
    state: SourceState
    error: str | None = None


def instagram_state() -> SourceState:
    return SourceState.REAL if find_spec("instaloader") else SourceState.NOT_CONFIGURED


class InstagramCollector:
    """Public-profile-only collector; never logs in or downloads media."""

    def __init__(self, loader_factory=None):
        self.loader_factory = loader_factory

    def collect(self, profile_url: str) -> ProfileData:
        username = urlsplit(profile_url).path.strip("/").split("/")[0]
        if not username:
            return ProfileData("instagram", profile_url, None, None, None, [], SourceState.FAILED, "Profile URL has no username")
        if not find_spec("instaloader") and self.loader_factory is None:
            return ProfileData("instagram", profile_url, username, None, None, [], SourceState.NOT_CONFIGURED, "Instaloader is not installed")
        try:
            if self.loader_factory:
                loader = self.loader_factory()
            else:
                import instaloader
                loader = instaloader.Instaloader(
                    quiet=True,
                    download_pictures=False,
                    download_videos=False,
                    download_video_thumbnails=False,
                    download_comments=False,
                    save_metadata=False,
                    request_timeout=8,
                )
            import instaloader
            profile = instaloader.Profile.from_username(loader.context, username)
            return ProfileData(
                "instagram",
                profile_url,
                profile.username,
                profile.full_name or None,
                profile.biography or None,
                [profile.external_url] if profile.external_url else [],
                SourceState.REAL,
            )
        except Exception as exc:
            name = type(exc).__name__.lower()
            state = SourceState.RATE_LIMITED if "rate" in name or "429" in str(exc) else SourceState.BLOCKED if "login" in name or "403" in str(exc) else SourceState.UNAVAILABLE
            return ProfileData("instagram", profile_url, username, None, None, [], state, f"Public profile collection failed: {type(exc).__name__}")


def parse_public_profile(platform: str, url: str, title: str | None, snippet: str | None, state: SourceState = SourceState.REAL) -> ProfileData:
    path = urlsplit(url).path.strip("/")
    username = path.split("/")[0] if path else None
    return ProfileData(platform, url, username, title, snippet, [], state)


def parse_play_result(url: str, title: str | None, snippet: str | None, state: SourceState = SourceState.REAL) -> AppData:
    parts = urlsplit(url).path.strip("/").split("/")
    package_id = parse_qs(urlsplit(url).query).get("id", [None])[0] if parts[:3] == ["store", "apps", "details"] else None
    return AppData(url, title, package_id, None, snippet, None, state)


def candidate_fingerprint(platform: str, identity: str) -> str:
    return sha256(f"{platform}:{identity.casefold().strip()}".encode()).hexdigest()


async def discover_social(client, brand: str, platform: str, max_results: int = 10) -> SearchResponse:
    query = f'"{brand}" {platform}'
    return await client.search(query)


async def discover_apps(client, brand: str, max_results: int = 10) -> SearchResponse:
    return await client.search(f'"{brand}" app site:play.google.com/store/apps')
