"""Match-score application logic and route dependencies."""

from __future__ import annotations

import math
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request

from app.database import MatchRepository, MatchResult, MatchStoreUnavailable
from app.errors import ServiceError


def get_match_repository(request: Request) -> MatchRepository:
    return request.app.state.match_repository


class MatchService:
    def __init__(self, repository: MatchRepository) -> None:
        self._repository = repository

    def calculate(self, cv_id: UUID, job_id: UUID) -> MatchResult:
        try:
            result = self._repository.calculate(cv_id, job_id)
        except MatchStoreUnavailable as error:
            raise _service_unavailable() from error

        normalized_reason = result.reason.strip() if result.reason else None
        normalized_reason = normalized_reason or None
        if result.score is None:
            if normalized_reason is None:
                raise _service_unavailable()
            return MatchResult(score=None, reason=normalized_reason)

        if (
            normalized_reason is not None
            or not math.isfinite(result.score)
            or result.score < 0.0
            or result.score > 1.0
        ):
            raise _service_unavailable()
        return MatchResult(score=result.score, reason=None)


def get_match_service(
    repository: Annotated[MatchRepository, Depends(get_match_repository)],
) -> MatchService:
    return MatchService(repository)


def _service_unavailable() -> ServiceError:
    return ServiceError(
        status_code=503,
        code="AI_SERVICE_UNAVAILABLE",
        message="AI match scoring is temporarily unavailable",
    )
