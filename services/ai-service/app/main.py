"""FastAPI entrypoint for the Recruitment AI Service."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from functools import partial
from threading import BoundedSemaphore
from typing import Annotated, cast
from uuid import UUID

from fastapi import Depends, FastAPI, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.responses import Response

from app.chat_provider import AnthropicChatProvider
from app.chat_recommendation import HttpCandidateJobRecommendationClient
from app.chat_service import ChatResult, ChatService
from app.chat_store import RedisChatStore
from app.config import Settings
from app.database import (
    MatchRepository,
    MatchStoreUnavailable,
    PsycopgMatchRepository,
    ReadinessProbe,
)
from app.errors import ServiceError, register_exception_handlers
from app.matching import MatchService, get_match_service
from app.metrics import MetricsRegistry
from app.models import (
    CandidateRecommendationItem,
    ChatData,
    ChatRequest,
    ChatResponse,
    ErrorResponse,
    JobRecommendationItem,
    MatchData,
    MatchRequest,
    MatchResponse,
    RecommendCandidatesData,
    RecommendCandidatesRequest,
    RecommendCandidatesResponse,
    RecommendJobsData,
    RecommendJobsRequest,
    RecommendJobsResponse,
)
from app.recommendation import (
    CandidateEligibility,
    CandidateRecommendationFilters,
    JobRecommendationFilters,
    RecommendationRepository,
    RecommendationService,
    get_candidate_recommendation_service,
    get_recommendation_service,
)
from app.recommendation_limiter import (
    RecommendationLimiter,
    RecommendationLimiterUnavailable,
    RecommendationSurface,
    RedisRecommendationLimiter,
)
from app.recommendation_repository import PsycopgRecommendationRepository
from app.security import (
    require_internal_api_key,
    require_job_search_candidate_recommendation_access,
    require_job_search_recommendation_access,
    require_metrics_scrape_access,
)
from app.user_auth import (
    AuthKeyUnavailable,
    InvalidAccessToken,
    JwksJwtAuthenticator,
)

chat_bearer = HTTPBearer(auto_error=False, scheme_name="ChatBearerAuth")


@dataclass(frozen=True, slots=True)
class CandidateChatContext:
    user_id: UUID
    access_token: str = field(repr=False, compare=False)


async def _shutdown_chat_executor(executor: ThreadPoolExecutor) -> None:
    """Drain chat workers without blocking the ASGI event loop they depend on."""

    await asyncio.to_thread(executor.shutdown, wait=True, cancel_futures=True)


def _finish_chat_worker(
    worker: asyncio.Future[ChatResult],
    admission: BoundedSemaphore,
) -> None:
    """Consume detached failures and release exactly one admission permit."""

    try:
        if not worker.cancelled():
            worker.exception()
    except (asyncio.CancelledError, Exception):
        pass
    finally:
        admission.release()


def require_candidate_chat_user(
    request: Request,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(chat_bearer),
    ],
) -> CandidateChatContext:
    settings = cast(Settings, request.app.state.settings)
    if not settings.chat_enabled:
        raise ServiceError(
            status_code=503,
            code="CHAT_NOT_CONFIGURED",
            message="The recruitment assistant is not enabled",
        )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ServiceError(
            status_code=401,
            code="INVALID_ACCESS_TOKEN",
            message="A valid access token is required",
        )
    authenticator = cast(
        JwksJwtAuthenticator | None,
        request.app.state.chat_authenticator,
    )
    if authenticator is None:
        raise ServiceError(
            status_code=503,
            code="AUTH_KEY_UNAVAILABLE",
            message="Authentication keys are temporarily unavailable",
        )
    try:
        user = authenticator.authenticate(credentials.credentials)
    except InvalidAccessToken as error:
        raise ServiceError(
            status_code=401,
            code="INVALID_ACCESS_TOKEN",
            message="A valid access token is required",
        ) from error
    except AuthKeyUnavailable as error:
        raise ServiceError(
            status_code=503,
            code="AUTH_KEY_UNAVAILABLE",
            message="Authentication keys are temporarily unavailable",
        ) from error
    if user.role != "CANDIDATE":
        raise ServiceError(
            status_code=403,
            code="CHAT_ACCESS_FORBIDDEN",
            message="Candidate access is required",
        )
    return CandidateChatContext(
        user_id=user.user_id,
        access_token=credentials.credentials,
    )


def create_app(
    *,
    settings: Settings | None = None,
    match_repository: MatchRepository | None = None,
    recommendation_repository: RecommendationRepository | None = None,
    readiness_probe: ReadinessProbe | None = None,
    chat_service: ChatService | None = None,
    chat_authenticator: JwksJwtAuthenticator | None = None,
    recommendation_limiter: RecommendationLimiter | None = None,
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
    default_recommendation_repository = PsycopgRecommendationRepository(
        runtime_settings.database_url,
        connect_timeout_seconds=runtime_settings.database_connect_timeout_seconds,
        statement_timeout_ms=runtime_settings.database_statement_timeout_ms,
    )
    selected_recommendation_repository = (
        recommendation_repository
        if recommendation_repository is not None
        else default_recommendation_repository
    )
    selected_readiness_probe = (
        readiness_probe if readiness_probe is not None else default_repository
    )

    @asynccontextmanager
    async def lifespan(lifespan_app: FastAPI) -> AsyncIterator[None]:
        owned_authenticator: JwksJwtAuthenticator | None = None
        owned_store: RedisChatStore | None = None
        owned_provider: AnthropicChatProvider | None = None
        owned_recommendation_client: HttpCandidateJobRecommendationClient | None = None
        owned_service: ChatService | None = None
        owned_chat_executor: ThreadPoolExecutor | None = None
        owned_limiter: RedisRecommendationLimiter | None = None
        try:
            runtime_settings.validate()
            if (
                runtime_settings.recommendation_rate_limit_enabled
                and lifespan_app.state.recommendation_limiter is None
            ):
                owned_limiter = RedisRecommendationLimiter.from_url(
                    runtime_settings.redis_url,
                    key_secret=(runtime_settings.recommendation_redis_key_secret),
                    window_seconds=(
                        runtime_settings.recommendation_rate_window_seconds
                    ),
                    subject_limit=(runtime_settings.recommendation_subject_rate_limit),
                    global_limit=(runtime_settings.recommendation_global_rate_limit),
                )
                lifespan_app.state.recommendation_limiter = owned_limiter
            if runtime_settings.chat_enabled:
                if lifespan_app.state.chat_executor is None:
                    owned_chat_executor = ThreadPoolExecutor(
                        max_workers=runtime_settings.chat_max_concurrent_requests,
                        thread_name_prefix="candidate-chat",
                    )
                    lifespan_app.state.chat_executor = owned_chat_executor
                    lifespan_app.state.chat_admission = BoundedSemaphore(
                        runtime_settings.chat_max_concurrent_requests
                    )
                if lifespan_app.state.chat_authenticator is None:
                    owned_authenticator = JwksJwtAuthenticator(
                        jwks_uri=runtime_settings.jwt_jwks_uri,
                        allowed_hosts=runtime_settings.jwt_jwks_allowed_hosts,
                        allow_insecure_http=runtime_settings.jwt_allow_insecure_jwks,
                        issuer=runtime_settings.jwt_issuer,
                        audience=runtime_settings.jwt_audience,
                        timeout_seconds=runtime_settings.jwt_jwks_timeout_seconds,
                        cache_ttl_seconds=runtime_settings.jwt_jwks_cache_ttl_seconds,
                    )
                    lifespan_app.state.chat_authenticator = owned_authenticator
                if lifespan_app.state.chat_service is None:
                    owned_store = RedisChatStore.from_url(
                        runtime_settings.redis_url,
                        key_secret=runtime_settings.chat_redis_key_secret,
                        history_ttl_seconds=runtime_settings.chat_history_ttl_seconds,
                        max_turns=runtime_settings.chat_history_max_turns,
                        rate_window_seconds=runtime_settings.chat_rate_window_seconds,
                        user_rate_limit=runtime_settings.chat_user_rate_limit,
                        global_rate_limit=runtime_settings.chat_global_rate_limit,
                        lock_ttl_seconds=runtime_settings.chat_session_lock_seconds,
                    )
                    owned_provider = AnthropicChatProvider(
                        api_key=runtime_settings.anthropic_api_key,
                        model=runtime_settings.anthropic_model,
                        timeout_seconds=runtime_settings.chat_provider_timeout_seconds,
                        max_output_tokens=runtime_settings.chat_max_output_tokens,
                    )
                    if runtime_settings.chat_recommendation_tool_enabled:
                        recommendation_client_type = (
                            HttpCandidateJobRecommendationClient
                        )
                        owned_recommendation_client = recommendation_client_type(
                            endpoint=(runtime_settings.chat_job_recommendation_url),
                            allowed_hosts=(
                                runtime_settings.chat_job_service_allowed_hosts
                            ),
                            allow_insecure_http=(
                                runtime_settings.chat_job_service_allow_insecure_http
                            ),
                            timeout_seconds=(
                                runtime_settings.chat_job_request_timeout_seconds
                            ),
                        )
                    owned_service = ChatService(
                        owned_store,
                        owned_provider,
                        owned_recommendation_client,
                        session_lease_renewal_seconds=max(
                            0.25,
                            runtime_settings.chat_session_lock_seconds / 3,
                        ),
                    )
                    lifespan_app.state.chat_service = owned_service
            yield
        finally:
            if lifespan_app.state.recommendation_limiter is owned_limiter:
                lifespan_app.state.recommendation_limiter = None
            if lifespan_app.state.chat_service is owned_service:
                lifespan_app.state.chat_service = None
            if lifespan_app.state.chat_authenticator is owned_authenticator:
                lifespan_app.state.chat_authenticator = None
            if lifespan_app.state.chat_executor is owned_chat_executor:
                lifespan_app.state.chat_executor = None
                lifespan_app.state.chat_admission = None
            if owned_chat_executor is not None:
                await _shutdown_chat_executor(owned_chat_executor)
            for resource in (
                owned_provider,
                owned_recommendation_client,
                owned_store,
                owned_authenticator,
                owned_limiter,
            ):
                if resource is not None:
                    try:
                        resource.close()
                    except Exception:
                        # Cleanup is best effort; never leak connection details.
                        pass

    application = FastAPI(
        title="Recruitment AI Service",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.settings = runtime_settings
    application.state.match_repository = selected_repository
    application.state.recommendation_repository = selected_recommendation_repository
    application.state.chat_service = chat_service
    application.state.chat_authenticator = chat_authenticator
    application.state.chat_executor = None
    application.state.chat_admission = None
    application.state.recommendation_limiter = recommendation_limiter
    application.state.metrics = MetricsRegistry()
    register_exception_handlers(application)

    @application.middleware("http")
    async def record_request_metrics(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        registry = cast(MetricsRegistry, request.app.state.metrics)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # A crash is still an availability event; record it before it is
            # translated into a 500 further up.
            registry.observe(request.url.path, 500, time.perf_counter() - started)
            raise
        registry.observe(
            request.url.path,
            response.status_code,
            time.perf_counter() - started,
        )
        return response

    @application.middleware("http")
    async def protect_chat_response(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        if request.url.path == "/chat":
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Pragma"] = "no-cache"
            response.headers["Vary"] = "Authorization"
        return response

    @application.get(
        "/metrics",
        responses={401: {"model": ErrorResponse}},
    )
    def metrics(
        request: Request,
        _: Annotated[None, Depends(require_metrics_scrape_access)],
    ) -> Response:
        # Operational detail is not public, and it is guarded by its own
        # credential: a caller allowed to score a match must not also be able
        # to read the traffic profile of the whole deployment.
        registry = cast(MetricsRegistry, request.app.state.metrics)
        return Response(
            content=registry.render(),
            media_type="text/plain; version=0.0.4; charset=utf-8",
            headers={"Cache-Control": "no-store"},
        )

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

    @application.post(
        "/chat",
        response_model=ChatResponse,
        responses={
            401: {"model": ErrorResponse},
            403: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            429: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
    )
    async def chat(
        payload: ChatRequest,
        request: Request,
        user: Annotated[
            CandidateChatContext,
            Depends(require_candidate_chat_user),
        ],
    ) -> ChatResponse:
        service = cast(ChatService | None, request.app.state.chat_service)
        if service is None:
            raise ServiceError(
                status_code=503,
                code="CHAT_NOT_CONFIGURED",
                message="The recruitment assistant is not enabled",
            )
        executor = cast(
            ThreadPoolExecutor | None,
            request.app.state.chat_executor,
        )
        admission = cast(
            BoundedSemaphore | None,
            request.app.state.chat_admission,
        )
        if executor is None or admission is None:
            raise ServiceError(
                status_code=503,
                code="CHAT_NOT_CONFIGURED",
                message="The recruitment assistant is not enabled",
            )
        if not admission.acquire(blocking=False):
            raise ServiceError(
                status_code=503,
                code="CHAT_BUSY",
                message="The recruitment assistant is busy; retry shortly",
                details={"retryAfterSeconds": 1},
                headers={"Retry-After": "1"},
            )
        try:
            worker = asyncio.get_running_loop().run_in_executor(
                executor,
                partial(
                    service.reply,
                    user.user_id,
                    payload.session_id,
                    payload.message,
                    access_token=user.access_token,
                ),
            )
        except RuntimeError as error:
            admission.release()
            raise ServiceError(
                status_code=503,
                code="CHAT_BUSY",
                message="The recruitment assistant is busy; retry shortly",
            ) from error
        worker.add_done_callback(partial(_finish_chat_worker, admission=admission))
        result = await asyncio.shield(worker)
        return ChatResponse(
            data=ChatData(
                session_id=payload.session_id,
                answer=result.answer,
            ),
            meta=None,
        )

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

    def enforce_recommendation_limit(
        request: Request,
        surface: RecommendationSurface,
        subject_id: UUID,
    ) -> None:
        """Charge the shared budget before any vector-store work is done."""
        limiter = cast(
            RecommendationLimiter | None,
            request.app.state.recommendation_limiter,
        )
        if limiter is None:
            return
        try:
            decision = limiter.consume(surface, subject_id)
        except RecommendationLimiterUnavailable as error:
            raise ServiceError(
                status_code=503,
                code="RECOMMENDATION_LIMIT_UNAVAILABLE",
                message="Recommendations are temporarily unavailable",
            ) from error
        if decision.allowed:
            return
        raise ServiceError(
            status_code=429,
            code="RECOMMENDATION_RATE_LIMITED",
            message="Too many recommendation requests; retry shortly",
            details={"retryAfterSeconds": decision.retry_after_seconds},
            headers={"Retry-After": str(decision.retry_after_seconds)},
        )

    @application.post(
        "/recommend/jobs",
        response_model=RecommendJobsResponse,
        responses={
            401: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            429: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
    )
    def recommend_jobs(
        payload: RecommendJobsRequest,
        request: Request,
        _: Annotated[
            None,
            Depends(require_job_search_recommendation_access),
        ],
        service: Annotated[
            RecommendationService,
            Depends(get_recommendation_service),
        ],
    ) -> RecommendJobsResponse:
        enforce_recommendation_limit(
            request,
            RecommendationSurface.JOBS,
            payload.cv_id,
        )
        result = service.recommend_jobs(
            payload.cv_id,
            JobRecommendationFilters(
                location=payload.location,
                salary_min=payload.salary_min,
                job_type=payload.job_type.value if payload.job_type else None,
            ),
            limit=payload.limit,
            cursor=payload.cursor,
        )
        return RecommendJobsResponse(
            data=RecommendJobsData(
                cv_id=payload.cv_id,
                items=[
                    JobRecommendationItem(job_id=item.item_id, score=item.score)
                    for item in result.items
                ],
                next_cursor=result.next_cursor,
                reason=result.reason,
            ),
            meta=None,
        )

    @application.post(
        "/recommend/candidates",
        response_model=RecommendCandidatesResponse,
        responses={
            401: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            429: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
    )
    def recommend_candidates(
        payload: RecommendCandidatesRequest,
        request: Request,
        _: Annotated[
            None,
            Depends(require_job_search_candidate_recommendation_access),
        ],
        service: Annotated[
            RecommendationService,
            Depends(get_candidate_recommendation_service),
        ],
    ) -> RecommendCandidatesResponse:
        enforce_recommendation_limit(
            request,
            RecommendationSurface.CANDIDATES,
            payload.job_id,
        )
        filters = CandidateRecommendationFilters(
            tuple(
                CandidateEligibility(
                    candidate_id=candidate.candidate_id,
                    cv_id=candidate.cv_id,
                    discovery_version=candidate.discovery_version,
                    profile_version=candidate.profile_version,
                )
                for candidate in payload.eligible_candidates
            )
        )
        result = service.recommend_candidates(
            payload.job_id,
            filters,
            job_version=payload.job_version,
            limit=payload.limit,
            cursor=payload.cursor,
        )
        return RecommendCandidatesResponse(
            data=RecommendCandidatesData(
                job_id=payload.job_id,
                items=[
                    CandidateRecommendationItem(
                        candidate_id=item.item_id,
                        score=item.score,
                    )
                    for item in result.items
                ],
                next_cursor=result.next_cursor,
                reason=result.reason,
            ),
            meta=None,
        )

    return application


app = create_app()
