from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./risk.db"
    jwt_secret: str = "development-only-change-me"
    jwt_expire_minutes: int = 60
    redis_url: str = "redis://localhost:6379/0"
    searxng_url: str | None = None
    max_domain_candidates: int = 100
    ollama_url: str | None = None
    ollama_model: str = "LiquidAI/lfm2.5-350m"
    max_ai_candidates: int = 5
    max_ai_evidence_items: int = 8
    max_ai_context_chars: int = 6000
    ollama_timeout_seconds: float = 120.0
    ollama_max_output_tokens: int = 256
    cors_origins: str = "http://localhost:5173"
    upload_dir: str = "./uploads"
    max_logo_bytes: int = 5_000_000
    enable_demo_account: bool = False
    demo_user_email: str = "demo@brand.local"
    demo_user_password: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
