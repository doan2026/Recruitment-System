"""HTTP request and response contracts."""

from __future__ import annotations

import unicodedata
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.job_events import JobType
from app.recommendation import (
    CANDIDATE_RECOMMENDATION_MAXIMUM_SCOPE,
    CandidateRecommendationReason,
    JobRecommendationReason,
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatRequest(StrictModel):
    session_id: UUID
    message: str = Field(min_length=1, max_length=2_000, strict=True)

    @field_validator("session_id", mode="before")
    @classmethod
    def require_canonical_uuid_v4(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        try:
            parsed = UUID(value)
        except ValueError:
            return value
        if parsed.version != 4 or str(parsed) != value:
            raise ValueError("session_id must be a canonical UUID v4")
        return value

    @field_validator("message", mode="before")
    @classmethod
    def normalize_message(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = unicodedata.normalize("NFC", value).strip()
        if not normalized:
            raise ValueError("message must not be blank")
        if len(normalized.encode("utf-8")) > 8_000:
            raise ValueError("message must contain at most 8000 UTF-8 bytes")
        if any(
            (ord(character) < 32 and character not in {"\n", "\t"})
            or 127 <= ord(character) <= 159
            for character in normalized
        ):
            raise ValueError("message must not contain control characters")
        return normalized


class ChatData(StrictModel):
    session_id: UUID
    answer: str = Field(min_length=1, max_length=8_000)


class ChatResponse(StrictModel):
    data: ChatData
    meta: None = None


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


class RecommendJobsRequest(StrictModel):
    cv_id: UUID
    limit: int = Field(default=10, ge=1, le=50, strict=True)
    cursor: str | None = Field(default=None, min_length=1, max_length=1024)
    location: str | None = Field(default=None, min_length=1, max_length=255)
    salary_min: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        le=Decimal("9999999999999.99"),
        decimal_places=2,
    )
    job_type: JobType | None = None

    @field_validator("location", mode="before")
    @classmethod
    def normalize_location(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        normalized = unicodedata.normalize("NFKC", value)
        if any(
            ord(character) < 32 or 127 <= ord(character) <= 159
            for character in normalized
        ):
            raise ValueError("location must not contain control characters")
        normalized = " ".join(normalized.split())
        if not normalized:
            raise ValueError("location must not be blank")
        if len(normalized) > 255:
            raise ValueError("location must contain at most 255 normalized characters")
        if any(character in normalized for character in ("%", "_", "\\")):
            raise ValueError("location must not contain wildcard characters")
        return normalized


class JobRecommendationItem(StrictModel):
    job_id: UUID
    score: float = Field(ge=0.0, le=1.0)


class RecommendJobsData(StrictModel):
    cv_id: UUID
    items: list[JobRecommendationItem]
    next_cursor: str | None = Field(default=None, max_length=1024)
    reason: JobRecommendationReason | None = None

    @model_validator(mode="after")
    def require_items_or_reason(self) -> RecommendJobsData:
        if bool(self.items) == (self.reason is not None):
            raise ValueError("exactly one of items or reason must be provided")
        if not self.items and self.next_cursor is not None:
            raise ValueError("an empty result cannot have a next cursor")
        return self


class RecommendJobsResponse(StrictModel):
    data: RecommendJobsData
    meta: None = None


class CandidateRecommendationEligibility(StrictModel):
    candidate_id: UUID
    cv_id: UUID
    discovery_version: int = Field(ge=1, le=2_147_483_647, strict=True)
    profile_version: int = Field(ge=1, le=2_147_483_647, strict=True)


class RecommendCandidatesRequest(StrictModel):
    job_id: UUID
    job_version: int = Field(ge=1, le=2_147_483_647, strict=True)
    eligible_candidates: list[CandidateRecommendationEligibility] = Field(
        min_length=1,
        max_length=CANDIDATE_RECOMMENDATION_MAXIMUM_SCOPE,
    )
    limit: int = Field(default=10, ge=1, le=50, strict=True)
    cursor: str | None = Field(default=None, min_length=1, max_length=1024)

    @model_validator(mode="after")
    def require_canonical_unique_scope(self) -> RecommendCandidatesRequest:
        candidate_ids = [
            str(candidate.candidate_id) for candidate in self.eligible_candidates
        ]
        cv_ids = [str(candidate.cv_id) for candidate in self.eligible_candidates]
        if (
            candidate_ids != sorted(candidate_ids)
            or len(set(candidate_ids)) != len(candidate_ids)
            or len(set(cv_ids)) != len(cv_ids)
        ):
            raise ValueError(
                "eligible_candidates must be sorted and contain unique Candidate/CV ids"
            )
        return self


class CandidateRecommendationItem(StrictModel):
    candidate_id: UUID
    score: float = Field(ge=0.0, le=1.0)


class RecommendCandidatesData(StrictModel):
    job_id: UUID
    items: list[CandidateRecommendationItem]
    next_cursor: str | None = Field(default=None, max_length=1024)
    reason: CandidateRecommendationReason | None = None

    @model_validator(mode="after")
    def require_items_or_reason(self) -> RecommendCandidatesData:
        if bool(self.items) == (self.reason is not None):
            raise ValueError("exactly one of items or reason must be provided")
        if not self.items and self.next_cursor is not None:
            raise ValueError("an empty result cannot have a next cursor")
        return self


class RecommendCandidatesResponse(StrictModel):
    data: RecommendCandidatesData
    meta: None = None


class ErrorResponse(StrictModel):
    code: str
    message: str
    details: dict[str, Any] | None = None
