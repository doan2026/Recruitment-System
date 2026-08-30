"""Internal service-to-service authentication."""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Depends, Header, Request
from fastapi.security import APIKeyHeader

from app.config import Settings
from app.errors import ServiceError

internal_api_key_header = APIKeyHeader(
    name="X-Internal-Api-Key",
    scheme_name="InternalApiKey",
    auto_error=False,
)

job_search_api_key_header = APIKeyHeader(
    name="X-Internal-Api-Key",
    scheme_name="JobSearchInternalApiKey",
    auto_error=False,
)

job_search_candidate_api_key_header = APIKeyHeader(
    name="X-Internal-Api-Key",
    scheme_name="JobSearchCandidateInternalApiKey",
    auto_error=False,
)


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def require_internal_api_key(
    supplied_key: Annotated[str | None, Depends(internal_api_key_header)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    expected_key = settings.internal_api_key.encode("utf-8")
    if supplied_key is None or not secrets.compare_digest(
        supplied_key.encode("utf-8"),
        expected_key,
    ):
        raise ServiceError(
            status_code=401,
            code="INVALID_INTERNAL_API_KEY",
            message="A valid internal API key is required",
        )


def require_metrics_scrape_access(
    supplied_key: Annotated[str | None, Depends(internal_api_key_header)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    """Guards the scrape with its own credential.

    Deliberately not ``INTERNAL_API_KEY``: a caller allowed to ask for a match
    score has no business reading the request rates and latency distribution of
    the whole deployment.
    """
    configured = settings.internal_api_key_metrics
    if not configured:
        # No scrape credential configured means no scrape: falling back to a
        # business key is exactly the reuse this dependency exists to prevent.
        raise ServiceError(
            status_code=401,
            code="INVALID_INTERNAL_API_KEY",
            message="A valid internal API key is required",
        )
    expected_key = configured.encode("utf-8")
    if supplied_key is None or not secrets.compare_digest(
        supplied_key.encode("utf-8"),
        expected_key,
    ):
        raise ServiceError(
            status_code=401,
            code="INVALID_INTERNAL_API_KEY",
            message="A valid internal API key is required",
        )


def require_job_search_recommendation_access(
    supplied_key: Annotated[str | None, Depends(job_search_api_key_header)],
    settings: Annotated[Settings, Depends(get_settings)],
    supplied_service: Annotated[
        str | None,
        Header(alias="X-Internal-Service"),
    ] = None,
) -> None:
    expected_key = settings.internal_api_key_job_search.encode("utf-8")
    valid_key = supplied_key is not None and secrets.compare_digest(
        supplied_key.encode("utf-8"),
        expected_key,
    )
    valid_service = supplied_service is not None and secrets.compare_digest(
        supplied_service.encode("utf-8"),
        b"job-search-service",
    )
    if not valid_key or not valid_service:
        raise ServiceError(
            status_code=401,
            code="INVALID_INTERNAL_CALLER",
            message="A valid scoped internal caller is required",
        )


def require_job_search_candidate_recommendation_access(
    supplied_key: Annotated[
        str | None,
        Depends(job_search_candidate_api_key_header),
    ],
    settings: Annotated[Settings, Depends(get_settings)],
    supplied_service: Annotated[
        str | None,
        Header(alias="X-Internal-Service"),
    ] = None,
) -> None:
    expected_key = settings.internal_api_key_job_search_candidates.encode("utf-8")
    valid_key = supplied_key is not None and secrets.compare_digest(
        supplied_key.encode("utf-8"),
        expected_key,
    )
    valid_service = supplied_service is not None and secrets.compare_digest(
        supplied_service.encode("utf-8"),
        b"job-search-service",
    )
    if not valid_key or not valid_service:
        raise ServiceError(
            status_code=401,
            code="INVALID_INTERNAL_CALLER",
            message="A valid scoped internal caller is required",
        )
