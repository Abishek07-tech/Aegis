from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, engine, get_db
from .models import (
    AIAnalysis, Candidate, Evidence, Investigation, OfficialAsset, OfficialRelationship,
    RiskFinding, ScanEvent, ScanJob, SourceResult, User,
)
from .schemas import (
    AIAnalysisResponse, AIProviderStatusResponse, AssetResponse, CandidateResponse, Credentials, DomainAnalysisResponse, EvidenceResponse, FindingResponse,
    InvestigationCreate, InvestigationResponse, ScanEventResponse, ScanResponse, SourceResultResponse, TokenResponse, UserResponse,
    RelationshipResponse,
)
from .identity import add_first_party_identity
from .domains import generate_domain_candidates
from .domain_analysis import analyze_domain_candidate
from .security import create_access_token, current_user, ensure_demo_account, hash_password, verify_password
from .sources import SearxngClient
from .website import WebsiteCollector
from .social_apps import candidate_fingerprint, discover_apps, discover_social, parse_play_result, parse_public_profile
from .social_app_analysis import analyze_social_app_candidate
from .ai import AIProviderState, build_evidence_bundle, configured_providers
from .url_safety import UnsafeUrl, normalize_public_url

settings = get_settings()
app = FastAPI(title="Digital Risk Protection API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.on_event("startup")
def create_tables() -> None:
    # Development bootstrap; production deployments should run Alembic.
    if settings.app_env == "development":
        Base.metadata.create_all(bind=engine)
    if settings.enable_demo_account:
        from .db import SessionLocal
        with SessionLocal() as db:
            ensure_demo_account(db, settings)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "api"}


@app.post("/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(credentials: Credentials, db: Session = Depends(get_db)) -> TokenResponse:
    existing = db.scalar(select(User).where(User.username == credentials.username))
    if existing:
        raise HTTPException(status_code=409, detail="Username is already registered")
    user = User(username=credentials.username, password_hash=hash_password(credentials.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id), user=UserResponse.model_validate(user))


@app.post("/auth/login", response_model=TokenResponse)
def login(credentials: Credentials, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.username == credentials.username))
    if user is None or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return TokenResponse(access_token=create_access_token(user.id), user=UserResponse.model_validate(user))


@app.get("/auth/me", response_model=UserResponse)
def me(user: User = Depends(current_user)) -> User:
    return user


def _safe_identity_url(value: str, expected_hosts: tuple[str, ...] = ()) -> str:
    try:
        normalized = normalize_public_url(value, resolve=False)
    except UnsafeUrl as exc:
        raise HTTPException(status_code=422, detail=f"Invalid official URL: {exc}") from exc
    hostname = (normalized.split("://", 1)[1].split("/", 1)[0].split(":", 1)[0]).lower()
    if expected_hosts and not any(hostname == host or hostname.endswith(f".{host}") for host in expected_hosts):
        raise HTTPException(status_code=422, detail="URL is not on the expected official platform")
    return normalized


def _add_user_asset(
    db: Session,
    investigation: Investigation,
    *,
    asset_type: str,
    url: str,
    platform: str | None = None,
    identifier: str | None = None,
    metadata: dict | None = None,
) -> OfficialAsset:
    existing = db.scalar(select(OfficialAsset).where(
        OfficialAsset.investigation_id == investigation.id,
        OfficialAsset.asset_type == asset_type,
        OfficialAsset.url == url,
    ))
    if existing:
        return existing
    asset = OfficialAsset(
        investigation_id=investigation.id,
        asset_type=asset_type,
        platform=platform,
        url=url,
        identifier=identifier,
        source="user_supplied",
        confidence=50,
        verified=False,
        verification_status="PENDING",
        metadata_json=metadata or {},
    )
    db.add(asset)
    return asset


def _public_asset(asset: OfficialAsset) -> dict:
    metadata = dict(asset.metadata_json or {})
    metadata.pop("storage_name", None)
    return {
        "id": asset.id,
        "asset_type": asset.asset_type,
        "platform": asset.platform,
        "url": asset.url,
        "identifier": asset.identifier,
        "source": asset.source,
        "confidence": asset.confidence,
        "verified": asset.verified,
        "verification_status": asset.verification_status,
        "metadata_json": metadata,
    }


@app.post("/investigations", response_model=InvestigationResponse, status_code=201)
def create_investigation(payload: InvestigationCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Investigation:
    website = _safe_identity_url(str(payload.official_website)) if payload.official_website else None
    socials = {
        "instagram": _safe_identity_url(str(payload.official_instagram), ("instagram.com",)) if payload.official_instagram else None,
        "facebook": _safe_identity_url(str(payload.official_facebook), ("facebook.com",)) if payload.official_facebook else None,
        "linkedin": _safe_identity_url(str(payload.official_linkedin), ("linkedin.com",)) if payload.official_linkedin else None,
        "x": _safe_identity_url(str(payload.official_x), ("x.com", "twitter.com")) if payload.official_x else None,
    }
    investigation = Investigation(
        user_id=user.id,
        company_name=payload.company_name.strip(),
        official_website=website,
        official_email_domain=payload.official_email_domain,
        official_instagram=socials["instagram"],
        official_facebook=socials["facebook"],
        official_linkedin=socials["linkedin"],
        official_x=socials["x"],
        other_official_information=payload.other_official_information.strip() if payload.other_official_information else None,
    )
    db.add(investigation)
    db.flush()
    if website:
        _add_user_asset(db, investigation, asset_type="website", platform="web", url=website, identifier=website.split("://", 1)[1].split("/", 1)[0])
    for platform, url in socials.items():
        if url:
            _add_user_asset(db, investigation, asset_type="social", platform=platform, url=url, identifier=url.rstrip("/").rsplit("/", 1)[-1])
    for app in payload.official_apps:
        store_url = _safe_identity_url(str(app.store_url))
        platform = "google_play" if "play.google.com" in store_url else "app_store" if "apps.apple.com" in store_url else "app_store"
        _add_user_asset(
            db,
            investigation,
            asset_type="app",
            platform=platform,
            url=store_url,
            identifier=app.package_id,
            metadata={"app_name": app.app_name, "package_id": app.package_id, "developer": app.developer},
        )
    if investigation.other_official_information:
        db.add(SourceResult(
            investigation_id=investigation.id,
            source="USER_SUPPLIED",
            query="other_official_information",
            url=None,
            title="User-supplied official identity context",
            snippet=investigation.other_official_information[:2000],
            state="REAL",
            collector="user_input",
            collector_version="1",
        ))
    db.commit()
    db.refresh(investigation)
    return investigation


@app.post("/investigations/{investigation_id}/logo", response_model=AssetResponse, status_code=201)
async def upload_logo(
    investigation_id: str,
    logo: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> AssetResponse:
    investigation = owned_investigation(investigation_id, user, db)
    allowed_types = {"image/png": ("png", "PNG"), "image/jpeg": ("jpg", "JPEG"), "image/webp": ("webp", "WEBP")}
    image_type = allowed_types.get((logo.content_type or "").lower())
    if image_type is None:
        raise HTTPException(status_code=415, detail="Logo must be PNG, JPEG, or WebP")
    extension, expected_format = image_type
    content = await logo.read(settings.max_logo_bytes + 1)
    if len(content) > settings.max_logo_bytes:
        raise HTTPException(status_code=413, detail="Logo exceeds the maximum allowed size")
    try:
        from PIL import Image
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            if image.format != expected_format:
                raise HTTPException(status_code=415, detail="Logo content does not match its declared file type")
            width, height = image.size
            if not (32 <= width <= 4096 and 32 <= height <= 4096):
                raise HTTPException(status_code=422, detail="Logo dimensions must be between 32 and 4096 pixels")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Logo is not a valid image") from exc
    target_dir = Path(settings.upload_dir) / user.id / investigation.id
    target_dir.mkdir(parents=True, exist_ok=True)
    storage_name = f"{uuid4().hex}.{extension}"
    (target_dir / storage_name).write_bytes(content)
    asset = _add_user_asset(
        db,
        investigation,
        asset_type="logo",
        platform="brand",
        url=f"/investigations/{investigation.id}/logo",
        metadata={"storage_name": storage_name, "mime_type": logo.content_type, "width": width, "height": height},
    )
    db.commit()
    db.refresh(asset)
    return _public_asset(asset)


@app.get("/investigations/{investigation_id}/logo")
def get_logo(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> FileResponse:
    investigation = owned_investigation(investigation_id, user, db)
    asset = db.scalar(select(OfficialAsset).where(
        OfficialAsset.investigation_id == investigation.id,
        OfficialAsset.asset_type == "logo",
    ))
    if not asset:
        raise HTTPException(status_code=404, detail="Logo not found")
    storage_name = asset.metadata_json.get("storage_name")
    if not storage_name or Path(storage_name).name != storage_name:
        raise HTTPException(status_code=404, detail="Logo not found")
    path = Path(settings.upload_dir) / user.id / investigation.id / storage_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(path, media_type=asset.metadata_json.get("mime_type", "application/octet-stream"))


@app.get("/investigations", response_model=list[InvestigationResponse])
def list_investigations(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[Investigation]:
    return list(db.scalars(select(Investigation).where(Investigation.user_id == user.id).order_by(Investigation.created_at.desc())))


def owned_investigation(investigation_id: str, user: User, db: Session) -> Investigation:
    investigation = db.scalar(select(Investigation).where(Investigation.id == investigation_id, Investigation.user_id == user.id))
    if investigation is None:
        raise HTTPException(status_code=404, detail="Investigation not found")
    return investigation


@app.get("/investigations/{investigation_id}", response_model=InvestigationResponse)
def get_investigation(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Investigation:
    return owned_investigation(investigation_id, user, db)


@app.get("/investigations/{investigation_id}/assets", response_model=list[AssetResponse])
def assets(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    investigation = owned_investigation(investigation_id, user, db)
    return [_public_asset(asset) for asset in db.scalars(select(OfficialAsset).where(OfficialAsset.investigation_id == investigation.id))]


@app.get("/investigations/{investigation_id}/relationships", response_model=list[RelationshipResponse])
def relationships(
    investigation_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[OfficialRelationship]:
    investigation = owned_investigation(investigation_id, user, db)
    return list(db.scalars(select(OfficialRelationship).where(
        OfficialRelationship.investigation_id == investigation.id,
    )))


@app.get("/investigations/{investigation_id}/candidates", response_model=list[CandidateResponse])
def candidates(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[Candidate]:
    investigation = owned_investigation(investigation_id, user, db)
    return list(db.scalars(select(Candidate).where(Candidate.investigation_id == investigation.id)))


@app.get("/investigations/{investigation_id}/domain-analysis", response_model=list[DomainAnalysisResponse])
def domain_analysis(
    investigation_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[DomainAnalysisResponse]:
    investigation = owned_investigation(investigation_id, user, db)
    result = []
    for candidate in db.scalars(select(Candidate).where(
        Candidate.investigation_id == investigation.id,
        Candidate.asset_type == "domain",
    )):
        finding = db.scalar(select(RiskFinding).where(RiskFinding.candidate_id == candidate.id))
        result.append(DomainAnalysisResponse(
            id=candidate.id,
            asset_type=candidate.asset_type,
            platform=candidate.platform,
            name=candidate.name,
            username=candidate.username,
            url=candidate.url,
            domain=candidate.domain,
            description=candidate.description,
            discovered_from=candidate.discovered_from,
            status=candidate.status,
            evidence_count=len(candidate.evidence),
            risk_score=finding.risk_score if finding else None,
            severity=finding.severity if finding else None,
            confidence=finding.confidence if finding else None,
        ))
    return result


@app.get("/investigations/{investigation_id}/findings", response_model=list[FindingResponse])
def findings(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[RiskFinding]:
    investigation = owned_investigation(investigation_id, user, db)
    return list(db.scalars(select(RiskFinding).where(RiskFinding.investigation_id == investigation.id)))


@app.get("/investigations/{investigation_id}/evidence", response_model=list[EvidenceResponse])
def evidence(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[Evidence]:
    investigation = owned_investigation(investigation_id, user, db)
    return list(db.scalars(
        select(Evidence).join(Candidate).where(Candidate.investigation_id == investigation.id)
    ))


@app.get("/investigations/{investigation_id}/sources", response_model=list[SourceResultResponse])
def source_results(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[SourceResult]:
    investigation = owned_investigation(investigation_id, user, db)
    return list(db.scalars(select(SourceResult).where(SourceResult.investigation_id == investigation.id)))


@app.get("/investigations/{investigation_id}/ai-analyses", response_model=list[AIAnalysisResponse])
def ai_analyses(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[AIAnalysis]:
    investigation = owned_investigation(investigation_id, user, db)
    return list(db.scalars(select(AIAnalysis).where(AIAnalysis.investigation_id == investigation.id).order_by(AIAnalysis.created_at.desc())))


@app.get("/ai/providers", response_model=list[AIProviderStatusResponse])
def provider_status() -> list[AIProviderStatusResponse]:
    import asyncio
    result = []
    for provider in configured_providers(settings):
        state, error = asyncio.run(provider.health_check())
        result.append(AIProviderStatusResponse(provider=provider.provider, model=provider.model or "", state=state.value, error=error))
    return result


@app.post("/investigations/{investigation_id}/rescan", response_model=ScanResponse, status_code=202)
def rescan(
    investigation_id: str,
    background_tasks: BackgroundTasks,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ScanJob:
    return start_scan(investigation_id, background_tasks, user, db)


def execute_scan(scan_id: str) -> None:
    # This compatibility path runs the verified SearXNG adapter. Long scans
    # should be moved to the existing Celery worker in the next slice.
    with next(get_db()) as db:
        scan = db.get(ScanJob, scan_id)
        if scan is None:
            return
        investigation = db.get(Investigation, scan.investigation_id)
        if investigation is None:
            scan.status = "FAILED"
            scan.error = "Investigation no longer exists"
            db.commit()
            return
        event = ScanEvent(scan_job_id=scan.id, stage="SEARCHING_WEB", message="Searching SearXNG", progress=20)
        db.add(event)
        client = SearxngClient(settings.searxng_url)
        import asyncio
        search_response = asyncio.run(client.search(f'"{investigation.company_name}" official'))
        db.add(SourceResult(
            investigation_id=investigation.id,
            source="SEARXNG",
            query=f'"{investigation.company_name}" official',
            url=search_response.results[0].url if search_response.results else None,
            title=search_response.results[0].title if search_response.results else None,
            snippet=search_response.results[0].snippet if search_response.results else None,
            state=search_response.state.value,
            error=search_response.error,
            collector=search_response.collector,
            collector_version=search_response.collector_version,
        ))
        db.add(ScanEvent(
            scan_job_id=scan.id,
            stage="SEARCHING_WEB",
            message=f"SearXNG state: {search_response.state.value}; results: {len(search_response.results)}",
            progress=35,
        ))
        for platform in ("instagram", "linkedin"):
            stage = f"DISCOVERING_{platform.upper()}"
            db.add(ScanEvent(scan_job_id=scan.id, stage=stage, message=f"Public {platform} discovery via SearXNG", progress=37))
            social_response = asyncio.run(discover_social(client, investigation.company_name, platform))
            db.add(SourceResult(
                investigation_id=investigation.id,
                source=platform.upper(),
                query=f'"{investigation.company_name}" {platform}',
                url=social_response.results[0].url if social_response.results else None,
                title=social_response.results[0].title if social_response.results else None,
                snippet=social_response.results[0].snippet if social_response.results else None,
                state=social_response.state.value,
                error=social_response.error,
                collector=social_response.collector,
                collector_version=social_response.collector_version,
            ))
            for result in social_response.results:
                if f"{platform}.com" not in result.url.lower():
                    continue
                profile = parse_public_profile(platform, result.url, result.title, result.snippet)
                fingerprint = candidate_fingerprint(platform, result.url)
                if db.scalar(select(Candidate).where(Candidate.investigation_id == investigation.id, Candidate.fingerprint == fingerprint)) is None:
                    db.add(Candidate(
                        investigation_id=investigation.id,
                        asset_type="social",
                        platform=platform,
                        name=profile.name,
                        username=profile.username,
                        url=profile.url,
                        description=profile.description,
                        discovered_from="searxng",
                        status="UNKNOWN",
                        fingerprint=fingerprint,
                    ))
            db.add(ScanEvent(
                scan_job_id=scan.id,
                stage=f"ANALYZING_{platform.upper()}",
                message=f"{platform} source state: {social_response.state.value}; candidates: {len(social_response.results)}",
                progress=40,
            ))
        db.add(ScanEvent(scan_job_id=scan.id, stage="DISCOVERING_GOOGLE_PLAY", message="Public Google Play discovery via SearXNG", progress=42))
        app_response = asyncio.run(discover_apps(client, investigation.company_name))
        db.add(SourceResult(
            investigation_id=investigation.id,
            source="GOOGLE_PLAY",
            query=f'"{investigation.company_name}" app site:play.google.com/store/apps',
            url=app_response.results[0].url if app_response.results else None,
            title=app_response.results[0].title if app_response.results else None,
            snippet=app_response.results[0].snippet if app_response.results else None,
            state=app_response.state.value,
            error=app_response.error,
            collector=app_response.collector,
            collector_version=app_response.collector_version,
        ))
        for result in app_response.results:
            if "play.google.com/store/apps/" not in result.url.lower():
                continue
            app = parse_play_result(result.url, result.title, result.snippet)
            identity = app.package_id or result.url
            fingerprint = candidate_fingerprint("google_play", identity)
            if db.scalar(select(Candidate).where(Candidate.investigation_id == investigation.id, Candidate.fingerprint == fingerprint)) is None:
                db.add(Candidate(
                    investigation_id=investigation.id,
                    asset_type="app",
                    platform="google_play",
                    name=app.app_name,
                    url=app.url,
                    description=app.description,
                    package_id=app.package_id,
                    developer=app.developer,
                    discovered_from="searxng",
                    status="UNKNOWN",
                    fingerprint=fingerprint,
                ))
        db.add(ScanEvent(scan_job_id=scan.id, stage="ANALYZING_GOOGLE_PLAY", message=f"Google Play source state: {app_response.state.value}; candidates: {len(app_response.results)}", progress=45))
        if investigation.official_website:
            db.add(ScanEvent(
                scan_job_id=scan.id,
                stage="ANALYZING_OFFICIAL_WEBSITE",
                message="Analyzing supplied official website",
                progress=45,
            ))
            website_response = asyncio.run(WebsiteCollector().collect(investigation.official_website))
            metadata = website_response.metadata
            db.add(SourceResult(
                investigation_id=investigation.id,
                source="WEBSITE",
                query="official_website",
                url=metadata.final_url if metadata else investigation.official_website,
                title=metadata.title if metadata else None,
                snippet=metadata.description if metadata else None,
                state=website_response.state.value,
                error=website_response.error,
                collector="website",
                collector_version="1",
            ))
            if metadata:
                add_first_party_identity(db, investigation, metadata)
            db.add(ScanEvent(
                scan_job_id=scan.id,
                stage="ANALYZING_OFFICIAL_WEBSITE",
                message=f"Website collector state: {website_response.state.value}",
                progress=55,
            ))
            try:
                domain_candidates = generate_domain_candidates(
                    metadata.final_url,
                    settings.max_domain_candidates,
                )
                domain_message = f"Generated {len(domain_candidates)} domain candidates; live analysis not yet run"
            except (AttributeError, TypeError, ValueError) as exc:
                domain_candidates = []
                domain_message = f"dnstwist generation failed: {exc}"
            for candidate in domain_candidates:
                existing_candidate = db.scalar(select(Candidate).where(
                    Candidate.investigation_id == investigation.id,
                    Candidate.fingerprint == candidate.fingerprint,
                ))
                if existing_candidate is None:
                    db.add(Candidate(
                        investigation_id=investigation.id,
                        asset_type="domain",
                        platform="web",
                        name=investigation.company_name,
                        url=f"https://{candidate.domain}/",
                        domain=candidate.domain,
                        description=f"Generated by dnstwist permutation: {candidate.permutation}",
                        discovered_from="dnstwist",
                        status="UNKNOWN",
                        fingerprint=candidate.fingerprint,
                    ))
            db.add(ScanEvent(
                scan_job_id=scan.id,
                stage="GENERATING_LOOKALIKE_DOMAINS",
                message=domain_message,
                progress=65,
            ))
            db.flush()
            db.add(ScanEvent(
                scan_job_id=scan.id,
                stage="ANALYZING_DNS",
                message=f"Analyzing {len(domain_candidates)} generated domain candidates",
                progress=70,
            ))
            for candidate in list(db.scalars(select(Candidate).where(
                Candidate.investigation_id == investigation.id,
                Candidate.discovered_from == "dnstwist",
                Candidate.status == "UNKNOWN",
            ))):
                try:
                    analyze_domain_candidate(db, investigation, candidate)
                except Exception as exc:
                    candidate.status = "UNKNOWN"
                    db.add(ScanEvent(
                        scan_job_id=scan.id,
                        stage="COLLECTING_CANDIDATE_EVIDENCE",
                        message=f"Candidate analysis failed for {candidate.domain}: {type(exc).__name__}",
                        progress=75,
                    ))
            db.add(ScanEvent(
                scan_job_id=scan.id,
                stage="CALCULATING_DOMAIN_RISK",
                message="Deterministic domain correlation completed; collector failures remain explicit",
                progress=90,
            ))
        db.add(ScanEvent(
            scan_job_id=scan.id,
            stage="CORRELATING_SOCIAL_ASSETS",
            message="Correlating public social and app discovery evidence",
            progress=92,
        ))
        for candidate in list(db.scalars(select(Candidate).where(
            Candidate.investigation_id == investigation.id,
            Candidate.asset_type.in_(("social", "app")),
        ))):
            try:
                analyze_social_app_candidate(db, investigation, candidate)
            except (TypeError, ValueError):
                candidate.status = "UNKNOWN"
        db.add(ScanEvent(
            scan_job_id=scan.id,
            stage="CORRELATING_APP_ASSETS",
            message="Social and app correlation completed without promoting search results to official assets",
            progress=95,
        ))
        db.add(ScanEvent(
            scan_job_id=scan.id,
            stage="RUNNING_AI_ANALYSTS",
            message="Running bounded AI analysis on evidence-backed candidates",
            progress=97,
        ))
        db.flush()
        providers = configured_providers(settings)
        ai_candidates = list(db.scalars(
            select(Candidate).where(
                Candidate.investigation_id == investigation.id,
                exists().where(Evidence.candidate_id == Candidate.id),
            ).order_by(Candidate.status.desc(), Candidate.id).limit(settings.max_ai_candidates)
        ))
        db.add(ScanEvent(
            scan_job_id=scan.id,
            stage="RUNNING_AI_ANALYSTS",
            message=f"Selected {len(ai_candidates)} evidence-backed candidates for AI analysis",
            progress=97,
        ))
        for candidate in ai_candidates:
            if not candidate.evidence:
                continue
            finding = db.scalar(select(RiskFinding).where(RiskFinding.candidate_id == candidate.id))
            import asyncio
            bundle = build_evidence_bundle(
                candidate,
                finding,
                settings.max_ai_context_chars,
                settings.max_ai_evidence_items,
                identity_assets=list(db.scalars(select(OfficialAsset).where(
                    OfficialAsset.investigation_id == investigation.id,
                ))),
                other_official_information=investigation.other_official_information,
            )
            for provider in providers:
                try:
                    result = asyncio.run(provider.analyze_candidate(bundle))
                except Exception as exc:
                    from .ai import AIResponse
                    result = AIResponse(
                        AIProviderState.FAILED,
                        error=f"{provider.provider} analysis failed: {type(exc).__name__}",
                        evidence_hash=bundle.evidence_hash,
                    )
                output = result.output
                db.add(AIAnalysis(
                    investigation_id=investigation.id,
                    candidate_id=candidate.id,
                    provider=provider.provider,
                    model=provider.model or provider.provider,
                    status=result.state.value,
                    classification=output.classification.value if output else None,
                    confidence=output.confidence if output else None,
                    priority=output.priority.value if output else None,
                    summary=output.summary if output else None,
                    supporting_evidence_ids=output.supporting_evidence_ids if output else [],
                    contradicting_evidence_ids=output.contradicting_evidence_ids if output else [],
                    recommendation=output.recommendation if output else None,
                    requires_human_review=output.requires_human_review if output else None,
                    prompt_version=provider.prompt_version,
                    evidence_hash=result.evidence_hash,
                    error=result.error,
                    raw_response=result.raw_response,
                ))
                db.add(ScanEvent(
                    scan_job_id=scan.id,
                    stage="RUNNING_AI_ANALYSTS",
                    message=(
                        f"{provider.provider} {result.state.value.lower()} for evidence-backed candidate "
                        f"(duration_ms={result.duration_ms or 0}, "
                        f"validation={'passed' if output else 'not-persisted'})"
                    ),
                    progress=98,
                ))
        db.add(ScanEvent(
            scan_job_id=scan.id,
            stage="STORING_AI_ANALYSIS",
            message="AI analysis stored; deterministic results remain authoritative",
            progress=99,
        ))
        scan.status = "COMPLETED"
        scan.progress = 100
        scan.completed_at = datetime.now(timezone.utc)
        investigation.status = "COMPLETED"
        investigation.completed_at = scan.completed_at
        db.commit()


@app.post("/investigations/{investigation_id}/scan", response_model=ScanResponse, status_code=202)
def start_scan(
    investigation_id: str,
    background_tasks: BackgroundTasks,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ScanJob:
    investigation = owned_investigation(investigation_id, user, db)
    scan = ScanJob(
        investigation_id=investigation.id,
        status="QUEUED",
        progress=0,
        started_at=datetime.now(timezone.utc),
    )
    investigation.status = "RUNNING"
    db.add(scan)
    db.commit()
    db.refresh(scan)
    background_tasks.add_task(execute_scan, scan.id)
    return scan


@app.get("/investigations/{investigation_id}/scan/status", response_model=ScanResponse)
def scan_status(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> ScanJob:
    investigation = owned_investigation(investigation_id, user, db)
    scan = db.scalar(select(ScanJob).where(ScanJob.investigation_id == investigation.id).order_by(ScanJob.started_at.desc()))
    if scan is None:
        raise HTTPException(status_code=404, detail="No scan has been started")
    return scan


@app.get("/investigations/{investigation_id}/scan/events", response_model=list[ScanEventResponse])
def scan_events(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[ScanEvent]:
    investigation = owned_investigation(investigation_id, user, db)
    scan = db.scalar(select(ScanJob).where(ScanJob.investigation_id == investigation.id).order_by(ScanJob.started_at.desc()))
    if scan is None:
        return []
    return list(db.scalars(select(ScanEvent).where(ScanEvent.scan_job_id == scan.id).order_by(ScanEvent.created_at.asc())))


@app.delete("/investigations/{investigation_id}", status_code=204)
def delete_investigation(investigation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    investigation = owned_investigation(investigation_id, user, db)
    db.delete(investigation)
    db.commit()
