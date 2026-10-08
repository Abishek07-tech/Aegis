from hashlib import sha256
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Investigation, OfficialAsset, OfficialRelationship
from .website import WebsiteMetadata


def _asset_key(asset_type: str, url: str) -> str:
    return sha256(f"{asset_type}:{url}".encode()).hexdigest()


def add_first_party_identity(
    db: Session,
    investigation: Investigation,
    metadata: WebsiteMetadata,
) -> list[OfficialAsset]:
    """Persist only assets directly corroborated by the supplied first-party site."""
    website_url = metadata.final_url
    existing = db.scalar(select(OfficialAsset).where(
        OfficialAsset.investigation_id == investigation.id,
        OfficialAsset.asset_type == "website",
        OfficialAsset.url == website_url,
    ))
    website_asset = existing or OfficialAsset(
        investigation_id=investigation.id,
        asset_type="website",
        platform="web",
        url=website_url,
        identifier=urlsplit(website_url).hostname,
        source="official_website",
        confidence=100,
        verified=True,
        verification_status="VERIFIED",
        metadata_json={},
    )
    if existing is None:
        db.add(website_asset)
        db.flush()
    assets = [website_asset]
    for social_url in metadata.social_links:
        platform = _platform(social_url)
        duplicate = db.scalar(select(OfficialAsset).where(
            OfficialAsset.investigation_id == investigation.id,
            OfficialAsset.url == social_url,
        ))
        social_asset = duplicate or OfficialAsset(
            investigation_id=investigation.id,
            asset_type="social",
            platform=platform,
            url=social_url,
            identifier=urlsplit(social_url).path.strip("/"),
            source="official_website",
            confidence=98,
            verified=True,
            verification_status="VERIFIED",
            metadata_json={},
        )
        if duplicate is None:
            db.add(social_asset)
            db.flush()
        assets.append(social_asset)
        relation = db.scalar(select(OfficialRelationship).where(
            OfficialRelationship.investigation_id == investigation.id,
            OfficialRelationship.source_asset_id == website_asset.id,
            OfficialRelationship.target_asset_id == social_asset.id,
        ))
        if relation is None:
            db.add(OfficialRelationship(
                investigation_id=investigation.id,
                source_asset_id=website_asset.id,
                target_asset_id=social_asset.id,
                relationship_type="official",
                confidence=98,
                source="html_social_link",
            ))
    return assets


def _platform(url: str) -> str:
    hostname = (urlsplit(url).hostname or "").lower()
    if "instagram." in hostname:
        return "instagram"
    if "linkedin." in hostname:
        return "linkedin"
    if hostname in {"x.com", "twitter.com", "www.twitter.com"}:
        return "x"
    if "facebook." in hostname:
        return "facebook"
    return "social"
