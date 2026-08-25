"""HTTP request and response contracts."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatRequest(StrictModel):
    session_id: str
    message: str


class MatchRequest(StrictModel):
    cv_id: UUID
    job_id: UUID


class MatchData(StrictModel):
    cv_id: UUID
    job_id: UUID
    score: float | None = Field(default=None, ge=0.0, le=1.0)
    reason: str | None = None

    @model_validator(mode="after")
    def require_score_or_reason(self) -> MatchData:
        normalized_reason = self.reason.strip() if self.reason else None
        if (self.score is None) == (normalized_reason is None):
            raise ValueError("exactly one of score or reason must be provided")
        self.reason = normalized_reason
        return self


class MatchResponse(StrictModel):
    data: MatchData
    meta: None = None


class ErrorResponse(StrictModel):
    code: str
    message: str
    details: dict[str, Any] | None = None
