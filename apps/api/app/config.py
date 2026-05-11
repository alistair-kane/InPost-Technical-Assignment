from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mongodb_uri: str
    mongodb_db: str = "inpost_assignment"
    mongodb_collection: str = "inpost_point_google_places"
    map_dashboard_api_secret: str
    cors_origins: str = "http://localhost:3000"

    @field_validator("map_dashboard_api_secret")
    @classmethod
    def secret_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("MAP_DASHBOARD_API_SECRET must be non-empty")
        return v

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
