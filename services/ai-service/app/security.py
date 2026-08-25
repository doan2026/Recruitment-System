"""Internal service-to-service authentication."""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import APIKeyHeader

from app.config import Settings
from app.errors import ServiceError

internal_api_key_header = APIKeyHeader(
    name="X-Internal-Api-Key",
    scheme_name="InternalApiKey",
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
