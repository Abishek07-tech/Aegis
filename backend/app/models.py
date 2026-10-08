from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, JSON, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    investigations: Mapped[list["Investigation"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Investigation(Base):
    __tablename__ = "investigations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    company_name: Mapped[str] = mapped_column(String(200))
    official_website: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    official_email_domain: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    official_instagram: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    official_facebook: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    official_linkedin: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    official_x: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    other_official_information: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="CREATED", index=True)
    overall_risk_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    user: Mapped[User] = relationship(back_populates="investigations")
    scan_jobs: Mapped[list["ScanJob"]] = relationship(back_populates="investigation", cascade="all, delete-orphan")
    assets: Mapped[list["OfficialAsset"]] = relationship(back_populates="investigation", cascade="all, delete-orphan")
    candidates: Mapped[list["Candidate"]] = relationship(back_populates="investigation", cascade="all, delete-orphan")
    findings: Mapped[list["RiskFinding"]] = relationship(back_populates="investigation", cascade="all, delete-orphan")
    source_results: Mapped[list["SourceResult"]] = relationship(back_populates="investigation", cascade="all, delete-orphan")


class ScanJob(Base):
    __tablename__ = "scan_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="QUEUED")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    investigation: Mapped[Investigation] = relationship(back_populates="scan_jobs")
    events: Mapped[list["ScanEvent"]] = relationship(back_populates="scan_job", cascade="all, delete-orphan")


class OfficialAsset(Base):
    __tablename__ = "official_assets"
    __table_args__ = (UniqueConstraint("investigation_id", "asset_type", "url", name="uq_official_asset_url"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    asset_type: Mapped[str] = mapped_column(String(40))
    platform: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    url: Mapped[str] = mapped_column(String(2048))
    identifier: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source: Mapped[str] = mapped_column(String(80))
    confidence: Mapped[int] = mapped_column(Integer)
    verified: Mapped[bool] = mapped_column(default=False)
    verification_status: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    investigation: Mapped[Investigation] = relationship(back_populates="assets")


class OfficialRelationship(Base):
    __tablename__ = "official_relationships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    source_asset_id: Mapped[str] = mapped_column(ForeignKey("official_assets.id", ondelete="CASCADE"))
    target_asset_id: Mapped[str] = mapped_column(ForeignKey("official_assets.id", ondelete="CASCADE"))
    relationship_type: Mapped[str] = mapped_column(String(40))
    confidence: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Candidate(Base):
    __tablename__ = "candidates"
    __table_args__ = (UniqueConstraint("investigation_id", "fingerprint", name="uq_candidate_fingerprint"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    asset_type: Mapped[str] = mapped_column(String(40))
    platform: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    url: Mapped[str] = mapped_column(String(2048))
    domain: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    package_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    developer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    discovered_from: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    investigation: Mapped[Investigation] = relationship(back_populates="candidates")
    evidence: Mapped[list["Evidence"]] = relationship(back_populates="candidate", cascade="all, delete-orphan")
    findings: Mapped[list["RiskFinding"]] = relationship(back_populates="candidate", cascade="all, delete-orphan")


class Evidence(Base):
    __tablename__ = "evidence"
    __table_args__ = (UniqueConstraint("candidate_id", "evidence_type", "source_url", "value", name="uq_evidence_identity"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), index=True)
    evidence_type: Mapped[str] = mapped_column(String(60))
    source_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    value: Mapped[str] = mapped_column(Text)
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    candidate: Mapped[Candidate] = relationship(back_populates="evidence")


class RiskFinding(Base):
    __tablename__ = "risk_findings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    candidate_id: Mapped[Optional[str]] = mapped_column(ForeignKey("candidates.id", ondelete="SET NULL"), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(60))
    severity: Mapped[str] = mapped_column(String(20))
    risk_score: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    explanation: Mapped[str] = mapped_column(Text)
    recommendation: Mapped[str] = mapped_column(Text)
    signals_json: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    investigation: Mapped[Investigation] = relationship(back_populates="findings")
    candidate: Mapped[Optional[Candidate]] = relationship(back_populates="findings")


class AIAnalysis(Base):
    __tablename__ = "ai_analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    candidate_id: Mapped[Optional[str]] = mapped_column(ForeignKey("candidates.id", ondelete="SET NULL"), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32))
    classification: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    confidence: Mapped[Optional[float]] = mapped_column(nullable=True)
    priority: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    supporting_evidence_ids: Mapped[list] = mapped_column(JSON, default=list)
    contradicting_evidence_ids: Mapped[list] = mapped_column(JSON, default=list)
    recommendation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    requires_human_review: Mapped[Optional[bool]] = mapped_column(nullable=True)
    prompt_version: Mapped[str] = mapped_column(String(40), default="ai-v1")
    evidence_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_response: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ScanEvent(Base):
    __tablename__ = "scan_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    scan_job_id: Mapped[str] = mapped_column(ForeignKey("scan_jobs.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(60))
    message: Mapped[str] = mapped_column(Text)
    progress: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    scan_job: Mapped[ScanJob] = relationship(back_populates="events")


class SourceResult(Base):
    __tablename__ = "source_results"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(80))
    query: Mapped[str] = mapped_column(Text)
    url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    snippet: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(String(32), default="REAL")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    collector: Mapped[str] = mapped_column(String(80), default="searxng")
    collector_version: Mapped[str] = mapped_column(String(40), default="1")
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    investigation: Mapped[Investigation] = relationship(back_populates="source_results")
