from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=120, pattern=r"^[A-Za-z0-9_.@+-]+$")
    password: str = Field(min_length=12, max_length=256)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    username: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class InvestigationCreate(BaseModel):
    company_name: str = Field(min_length=1, max_length=200)
    official_website: HttpUrl | None = None
    official_email_domain: str | None = Field(default=None, max_length=255)
    official_instagram: HttpUrl | None = None
    official_facebook: HttpUrl | None = None
    official_linkedin: HttpUrl | None = None
    official_x: HttpUrl | None = None
    official_apps: list["OfficialAppInput"] = Field(default_factory=list, max_length=20)
    other_official_information: str | None = Field(default=None, max_length=5000)


class OfficialAppInput(BaseModel):
    app_name: str = Field(min_length=1, max_length=255)
    store_url: HttpUrl
    package_id: str | None = Field(default=None, max_length=255)
    developer: str | None = Field(default=None, max_length=255)


class InvestigationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    company_name: str
    official_website: str | None
    official_email_domain: str | None
    official_instagram: str | None
    official_facebook: str | None
    official_linkedin: str | None
    official_x: str | None
    other_official_information: str | None
    status: str
    overall_risk_score: int | None
    created_at: datetime


class ScanResponse(BaseModel):
    id: str
    status: str
    progress: int
    error: str | None = None


class ScanEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    stage: str
    message: str
    progress: int
    created_at: datetime


class AssetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    asset_type: str
    platform: str | None
    url: str
    identifier: str | None
    source: str
    confidence: int
    verified: bool
    verification_status: str
    metadata_json: dict


class RelationshipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    source_asset_id: str
    target_asset_id: str
    relationship_type: str
    confidence: int
    source: str


class CandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    asset_type: str
    platform: str | None
    name: str | None
    username: str | None
    url: str
    domain: str | None
    package_id: str | None
    developer: str | None
    description: str | None
    discovered_from: str
    status: str


class DomainAnalysisResponse(CandidateResponse):
    evidence_count: int
    risk_score: int | None
    severity: str | None
    confidence: int | None


class EvidenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    candidate_id: str
    evidence_type: str
    source_url: str | None
    value: str
    score: int | None
    metadata_json: dict


class FindingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    candidate_id: str | None
    category: str
    severity: str
    risk_score: int
    confidence: int
    title: str
    explanation: str
    recommendation: str
    signals_json: list


class SourceResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    source: str
    query: str
    url: str | None
    title: str | None
    snippet: str | None
    state: str
    error: str | None
    collector: str
    collector_version: str


class AIAnalysisResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    candidate_id: str | None
    provider: str
    model: str
    status: str
    classification: str | None
    confidence: float | None
    priority: str | None
    summary: str | None
    supporting_evidence_ids: list[str]
    contradicting_evidence_ids: list[str]
    recommendation: str | None
    requires_human_review: bool | None
    prompt_version: str
    evidence_hash: str | None
    error: str | None
    created_at: datetime


class AIProviderStatusResponse(BaseModel):
    provider: str
    model: str
    state: str
    error: str | None = None


class ApiResponse(BaseModel):
    success: bool = True
    data: Any = None
    error: Any = None
