"""Shared API errors and FastAPI exception handlers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


@dataclass(slots=True)
class ServiceError(Exception):
    status_code: int
    code: str
    message: str
    details: dict[str, Any] | None = None
    headers: dict[str, str] | None = None


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def handle_service_error(
        _: Request,
        error: ServiceError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            headers=error.headers,
            content={
                "code": error.code,
                "message": error.message,
                "details": error.details,
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        validation_errors = [
            {
                "field": ".".join(str(part) for part in item["loc"]),
                "message": item["msg"],
                "type": item["type"],
            }
            for item in error.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": {"errors": validation_errors},
            },
        )
