"""FastAPI entrypoint for the Recruitment AI Service."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI

from app.config import Settings
from app.database import (
    MatchRepository,
    MatchStoreUnavailable,
    PsycopgMatchRepository,
    ReadinessProbe,
)
from app.errors import ServiceError, register_exception_handlers
from app.matching import MatchService, get_match_service
from app.models import (
    ChatRequest,
    ErrorResponse,
    MatchData,
    MatchRequest,
    MatchResponse,
)
from app.security import require_internal_api_key


def create_app(
    *,
    settings: Settings | None = None,
    match_repository: MatchRepository | None = None,
    readiness_probe: ReadinessProbe | None = None,
) -> FastAPI:
    runtime_settings = settings or Settings.from_environment()
    default_repository = PsycopgMatchRepository(
        runtime_settings.database_url,
        connect_timeout_seconds=runtime_settings.database_connect_timeout_seconds,
        statement_timeout_ms=runtime_settings.database_statement_timeout_ms,
    )
    selected_repository = (
        match_repository if match_repository is not None else default_repository
    )
    selected_readiness_probe = (
        readiness_probe if readiness_probe is not None else default_repository
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        runtime_settings.validate()
        yield

    application = FastAPI(
        title="Recruitment AI Service",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.settings = runtime_settings
    application.state.match_repository = selected_repository
    register_exception_handlers(application)

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"service": "ai-service", "status": "UP"}

    @application.get(
        "/ready",
        responses={503: {"model": ErrorResponse}},
    )
    def ready() -> dict[str, str]:
        try:
            selected_readiness_probe.check()
        except MatchStoreUnavailable as error:
            raise ServiceError(
                status_code=503,
                code="AI_SERVICE_UNAVAILABLE",
                message="AI vector store is not ready",
            ) from error
        return {"service": "ai-service", "status": "READY"}

    @application.post("/chat")
    def chat(_: ChatRequest) -> dict[str, str]:
        return {"message": "AI chat service is ready for provider integration."}

    @application.post(
        "/match",
        response_model=MatchResponse,
        responses={
            401: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
    )
    def match(
        payload: MatchRequest,
        _: Annotated[None, Depends(require_internal_api_key)],
        service: Annotated[MatchService, Depends(get_match_service)],
    ) -> MatchResponse:
        result = service.calculate(payload.cv_id, payload.job_id)
        return MatchResponse(
            data=MatchData(
                cv_id=payload.cv_id,
                job_id=payload.job_id,
                score=result.score,
                reason=result.reason,
            ),
            meta=None,
        )

    return application


app = create_app()
