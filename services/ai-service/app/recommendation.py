"""Deterministic, privacy-minimal recommendation application logic."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import re
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from fastapi import Request

from app.errors import ServiceError

_CURSOR_VERSION = 1
_CURSOR_MAXIMUM_BYTES = 1024
RECOMMENDATION_MAXIMUM_PAGES = 10
CANDIDATE_RECOMMENDATION_MAXIMUM_SCOPE = 500
_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class JobRecommendationReason(StrEnum):
    CV_EMBEDDING_NOT_FOUND = "CV_EMBEDDING_NOT_FOUND"
    CV_EMBEDDING_INACTIVE = "CV_EMBEDDING_INACTIVE"
    NO_ACTIVE_JOB_EMBEDDINGS = "NO_ACTIVE_JOB_EMBEDDINGS"
    EMBEDDING_MODEL_MISMATCH = "EMBEDDING_MODEL_MISMATCH"
    NO_MATCHING_JOB_EMBEDDINGS = "NO_MATCHING_JOB_EMBEDDINGS"


class CandidateRecommendationReason(StrEnum):
    JOB_EMBEDDING_NOT_FOUND = "JOB_EMBEDDING_NOT_FOUND"
    JOB_EMBEDDING_INACTIVE = "JOB_EMBEDDING_INACTIVE"
    NO_ACTIVE_CV_EMBEDDINGS = "NO_ACTIVE_CV_EMBEDDINGS"
    EMBEDDING_MODEL_MISMATCH = "EMBEDDING_MODEL_MISMATCH"
    NO_MATCHING_CV_EMBEDDINGS = "NO_MATCHING_CV_EMBEDDINGS"


RecommendationReason = JobRecommendationReason | CandidateRecommendationReason


class RecommendationKind(StrEnum):
    JOBS = "jobs"
    CANDIDATES = "candidates"


class RecommendationStoreUnavailable(RuntimeError):
    """The vector store could not return a trustworthy recommendation page."""


class InvalidRecommendationCursor(ValueError):
    """The cursor is malformed, forged or belongs to another query."""


class StaleRecommendationCursor(RuntimeError):
    """The cursor snapshot no longer matches the current vector set."""


@dataclass(frozen=True, slots=True)
class JobRecommendationFilters:
    location: str | None = None
    salary_min: Decimal | None = None
    job_type: str | None = None


@dataclass(frozen=True, slots=True)
class CandidateEligibility:
    candidate_id: UUID
    cv_id: UUID
    discovery_version: int
    profile_version: int


@dataclass(frozen=True, slots=True)
class CandidateRecommendationFilters:
    eligible_candidates: tuple[CandidateEligibility, ...]


@dataclass(frozen=True, slots=True)
class RecommendationBoundary:
    distance: float
    item_id: UUID
    page: int = 1


@dataclass(frozen=True, slots=True)
class DecodedRecommendationCursor:
    source_fingerprint: str
    boundary: RecommendationBoundary


@dataclass(frozen=True, slots=True)
class RecommendationDistanceItem:
    item_id: UUID
    distance: float


@dataclass(frozen=True, slots=True)
class RecommendationPage:
    items: tuple[RecommendationDistanceItem, ...]
    source_fingerprint: str | None
    next_boundary: RecommendationBoundary | None
    reason: RecommendationReason | None


@dataclass(frozen=True, slots=True)
class ScoredRecommendationItem:
    item_id: UUID
    score: float


@dataclass(frozen=True, slots=True)
class RecommendationOutput:
    items: tuple[ScoredRecommendationItem, ...]
    next_cursor: str | None
    reason: RecommendationReason | None


class RecommendationRepository(Protocol):
    def recommend_jobs(
        self,
        cv_id: UUID,
        filters: JobRecommendationFilters,
        *,
        limit: int,
        boundary: RecommendationBoundary | None,
        expected_source_fingerprint: str | None,
    ) -> RecommendationPage: ...

    def recommend_candidates(
        self,
        job_id: UUID,
        filters: CandidateRecommendationFilters,
        *,
        job_version: int,
        limit: int,
        boundary: RecommendationBoundary | None,
        expected_source_fingerprint: str | None,
    ) -> RecommendationPage: ...


class RecommendationCursorCodec:
    def __init__(self, secret: str) -> None:
        if not secret:
            raise ValueError("cursor secret must not be empty")
        self._secret = secret.encode("utf-8")

    def encode(
        self,
        kind: RecommendationKind,
        *,
        source_fingerprint: str,
        filter_fingerprint: str,
        boundary: RecommendationBoundary,
    ) -> str:
        if not _HASH_PATTERN.fullmatch(source_fingerprint):
            raise RecommendationStoreUnavailable
        if not _HASH_PATTERN.fullmatch(filter_fingerprint):
            raise RecommendationStoreUnavailable
        _validate_boundary(boundary, RecommendationStoreUnavailable)
        payload = {
            "d": format(boundary.distance, ".17g"),
            "f": filter_fingerprint,
            "i": str(boundary.item_id),
            "k": kind.value,
            "p": boundary.page,
            "s": source_fingerprint,
            "v": _CURSOR_VERSION,
        }
        encoded_payload = _base64url_encode(
            json.dumps(
                payload,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        signature = hmac.new(
            self._secret,
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        token = f"{encoded_payload}.{_base64url_encode(signature)}"
        if len(token.encode("ascii")) > _CURSOR_MAXIMUM_BYTES:
            raise RecommendationStoreUnavailable
        return token

    def decode(
        self,
        token: str,
        kind: RecommendationKind,
        *,
        filter_fingerprint: str,
    ) -> DecodedRecommendationCursor:
        try:
            encoded = token.encode("ascii")
            if not encoded or len(encoded) > _CURSOR_MAXIMUM_BYTES:
                raise ValueError
            encoded_payload, encoded_signature = token.split(".")
            supplied_signature = _base64url_decode(encoded_signature)
            expected_signature = hmac.new(
                self._secret,
                encoded_payload.encode("ascii"),
                hashlib.sha256,
            ).digest()
            if not hmac.compare_digest(supplied_signature, expected_signature):
                raise ValueError
            raw_payload = _base64url_decode(encoded_payload)
            payload = json.loads(raw_payload)
            if not isinstance(payload, dict) or set(payload) != {
                "d",
                "f",
                "i",
                "k",
                "p",
                "s",
                "v",
            }:
                raise ValueError
            canonical_payload = json.dumps(
                payload,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            if raw_payload != canonical_payload:
                raise ValueError
            version = payload["v"]
            if (
                not isinstance(version, int)
                or isinstance(version, bool)
                or version != _CURSOR_VERSION
                or payload["k"] != kind.value
                or payload["f"] != filter_fingerprint
                or not isinstance(payload["p"], int)
                or isinstance(payload["p"], bool)
                or payload["p"] < 1
                or payload["p"] > RECOMMENDATION_MAXIMUM_PAGES
                or not isinstance(payload["s"], str)
                or not _HASH_PATTERN.fullmatch(payload["s"])
                or not isinstance(payload["d"], str)
                or not isinstance(payload["i"], str)
            ):
                raise ValueError
            item_id = UUID(payload["i"])
            if str(item_id) != payload["i"]:
                raise ValueError
            boundary = RecommendationBoundary(
                distance=float(payload["d"]),
                item_id=item_id,
                page=payload["p"],
            )
            _validate_boundary(boundary, ValueError)
        except (
            UnicodeEncodeError,
            UnicodeDecodeError,
            ValueError,
            TypeError,
            json.JSONDecodeError,
        ) as error:
            raise InvalidRecommendationCursor from error
        return DecodedRecommendationCursor(
            source_fingerprint=payload["s"],
            boundary=boundary,
        )


class RecommendationService:
    def __init__(
        self, repository: RecommendationRepository, cursor_secret: str
    ) -> None:
        self._repository = repository
        self._cursor_codec = RecommendationCursorCodec(cursor_secret)

    def recommend_jobs(
        self,
        cv_id: UUID,
        filters: JobRecommendationFilters,
        *,
        limit: int,
        cursor: str | None,
    ) -> RecommendationOutput:
        filter_fingerprint = _job_filter_fingerprint(filters)
        decoded = self._decode_cursor(
            cursor,
            RecommendationKind.JOBS,
            filter_fingerprint=filter_fingerprint,
        )
        try:
            page = self._repository.recommend_jobs(
                cv_id,
                filters,
                limit=limit,
                boundary=decoded.boundary if decoded else None,
                expected_source_fingerprint=(
                    decoded.source_fingerprint if decoded else None
                ),
            )
        except RecommendationStoreUnavailable as error:
            raise _service_unavailable() from error
        except StaleRecommendationCursor as error:
            raise _stale_cursor() from error
        return self._build_output(
            page,
            kind=RecommendationKind.JOBS,
            filter_fingerprint=filter_fingerprint,
            limit=limit,
            allowed_reasons=frozenset(JobRecommendationReason),
            expected_next_page=decoded.boundary.page + 1 if decoded else 1,
            incoming_boundary=decoded.boundary if decoded else None,
        )

    def recommend_candidates(
        self,
        job_id: UUID,
        filters: CandidateRecommendationFilters,
        *,
        job_version: int,
        limit: int,
        cursor: str | None,
    ) -> RecommendationOutput:
        _validate_candidate_filters(filters, job_version=job_version)
        filter_fingerprint = _candidate_filter_fingerprint(
            filters,
            job_version=job_version,
        )
        decoded = self._decode_cursor(
            cursor,
            RecommendationKind.CANDIDATES,
            filter_fingerprint=filter_fingerprint,
        )
        try:
            page = self._repository.recommend_candidates(
                job_id,
                filters,
                job_version=job_version,
                limit=limit,
                boundary=decoded.boundary if decoded else None,
                expected_source_fingerprint=(
                    decoded.source_fingerprint if decoded else None
                ),
            )
        except RecommendationStoreUnavailable as error:
            raise _service_unavailable() from error
        except StaleRecommendationCursor as error:
            raise _stale_cursor() from error
        output = self._build_output(
            page,
            kind=RecommendationKind.CANDIDATES,
            filter_fingerprint=filter_fingerprint,
            limit=limit,
            allowed_reasons=frozenset(CandidateRecommendationReason),
            expected_next_page=decoded.boundary.page + 1 if decoded else 1,
            incoming_boundary=decoded.boundary if decoded else None,
        )
        allowed_candidates = {
            candidate.candidate_id for candidate in filters.eligible_candidates
        }
        if any(item.item_id not in allowed_candidates for item in output.items):
            raise _service_unavailable()
        return output

    def _decode_cursor(
        self,
        cursor: str | None,
        kind: RecommendationKind,
        *,
        filter_fingerprint: str,
    ) -> DecodedRecommendationCursor | None:
        if cursor is None:
            return None
        try:
            decoded = self._cursor_codec.decode(
                cursor,
                kind,
                filter_fingerprint=filter_fingerprint,
            )
            if decoded.boundary.page >= RECOMMENDATION_MAXIMUM_PAGES:
                raise InvalidRecommendationCursor
            return decoded
        except InvalidRecommendationCursor as error:
            raise ServiceError(
                status_code=409,
                code="RECOMMENDATION_CURSOR_STALE",
                message="The recommendation data changed; restart pagination",
            ) from error

    def _build_output(
        self,
        page: RecommendationPage,
        *,
        kind: RecommendationKind,
        filter_fingerprint: str,
        limit: int,
        allowed_reasons: frozenset[RecommendationReason],
        expected_next_page: int,
        incoming_boundary: RecommendationBoundary | None,
    ) -> RecommendationOutput:
        if len(page.items) > limit:
            raise _service_unavailable()
        if page.items:
            if page.reason is not None or page.source_fingerprint is None:
                raise _service_unavailable()
        elif page.reason not in allowed_reasons or page.next_boundary is not None:
            raise _service_unavailable()

        seen: set[UUID] = set()
        scored: list[ScoredRecommendationItem] = []
        previous: tuple[float, int] | None = (
            (incoming_boundary.distance, incoming_boundary.item_id.int)
            if incoming_boundary is not None
            else None
        )
        for item in page.items:
            boundary = RecommendationBoundary(item.distance, item.item_id)
            try:
                _validate_boundary(boundary, ValueError)
            except ValueError as error:
                raise _service_unavailable() from error
            ordering = (item.distance, item.item_id.int)
            if item.item_id in seen or (previous is not None and ordering <= previous):
                raise _service_unavailable()
            seen.add(item.item_id)
            previous = ordering
            score = 1.0 - (item.distance / 2.0)
            if not math.isfinite(score) or score < 0.0 or score > 1.0:
                raise _service_unavailable()
            scored.append(ScoredRecommendationItem(item.item_id, score))

        next_cursor = None
        if page.next_boundary is not None:
            if (
                not page.items
                or page.next_boundary.distance != page.items[-1].distance
                or page.next_boundary.item_id != page.items[-1].item_id
                or page.next_boundary.page != expected_next_page
                or expected_next_page > RECOMMENDATION_MAXIMUM_PAGES
                or page.source_fingerprint is None
            ):
                raise _service_unavailable()
            next_cursor = self._cursor_codec.encode(
                kind,
                source_fingerprint=page.source_fingerprint,
                filter_fingerprint=filter_fingerprint,
                boundary=page.next_boundary,
            )
        return RecommendationOutput(tuple(scored), next_cursor, page.reason)


def get_recommendation_service(request: Request) -> RecommendationService:
    return RecommendationService(
        request.app.state.recommendation_repository,
        request.app.state.settings.internal_api_key_job_search,
    )


def get_candidate_recommendation_service(
    request: Request,
) -> RecommendationService:
    return RecommendationService(
        request.app.state.recommendation_repository,
        request.app.state.settings.internal_api_key_job_search_candidates,
    )


def _job_filter_fingerprint(filters: JobRecommendationFilters) -> str:
    return _sha256_json(
        {
            "job_type": filters.job_type,
            "location": filters.location,
            "salary_min": (
                format(filters.salary_min, "f")
                if filters.salary_min is not None
                else None
            ),
        }
    )


def _candidate_filter_fingerprint(
    filters: CandidateRecommendationFilters,
    *,
    job_version: int,
) -> str:
    return _sha256_json(
        {
            "job_version": job_version,
            "eligible_candidates": [
                {
                    "candidate_id": str(candidate.candidate_id),
                    "cv_id": str(candidate.cv_id),
                    "discovery_version": candidate.discovery_version,
                    "profile_version": candidate.profile_version,
                }
                for candidate in filters.eligible_candidates
            ],
        }
    )


def _validate_candidate_filters(
    filters: CandidateRecommendationFilters,
    *,
    job_version: int,
) -> None:
    candidates = filters.eligible_candidates
    candidate_ids = [candidate.candidate_id for candidate in candidates]
    cv_ids = [candidate.cv_id for candidate in candidates]
    if (
        not isinstance(job_version, int)
        or isinstance(job_version, bool)
        or not 1 <= job_version <= 2_147_483_647
        or not candidates
        or len(candidates) > CANDIDATE_RECOMMENDATION_MAXIMUM_SCOPE
        or any(
            not isinstance(candidate.candidate_id, UUID)
            or not isinstance(candidate.cv_id, UUID)
            for candidate in candidates
        )
        or candidate_ids != sorted(candidate_ids, key=lambda value: value.int)
        or len(set(candidate_ids)) != len(candidate_ids)
        or len(set(cv_ids)) != len(cv_ids)
        or any(
            not isinstance(candidate.discovery_version, int)
            or isinstance(candidate.discovery_version, bool)
            or not 1 <= candidate.discovery_version <= 2_147_483_647
            or not isinstance(candidate.profile_version, int)
            or isinstance(candidate.profile_version, bool)
            or not 1 <= candidate.profile_version <= 2_147_483_647
            for candidate in candidates
        )
    ):
        raise _service_unavailable()


def _sha256_json(value: object) -> str:
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _validate_boundary(
    boundary: RecommendationBoundary,
    error_type: type[Exception],
) -> None:
    if (
        not isinstance(boundary.item_id, UUID)
        or not isinstance(boundary.page, int)
        or isinstance(boundary.page, bool)
        or boundary.page < 1
        or boundary.page > RECOMMENDATION_MAXIMUM_PAGES
        or not math.isfinite(boundary.distance)
        or boundary.distance < 0.0
        or boundary.distance > 2.0
    ):
        raise error_type()


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    if not value or re.fullmatch(r"[A-Za-z0-9_-]+", value) is None:
        raise ValueError
    encoded = value.encode("ascii")
    padding = b"=" * ((4 - len(encoded) % 4) % 4)
    decoded = base64.b64decode(encoded + padding, altchars=b"-_", validate=True)
    if _base64url_encode(decoded) != value:
        raise ValueError
    return decoded


def _service_unavailable() -> ServiceError:
    return ServiceError(
        status_code=503,
        code="AI_SERVICE_UNAVAILABLE",
        message="AI recommendations are temporarily unavailable",
    )


def _stale_cursor() -> ServiceError:
    return ServiceError(
        status_code=409,
        code="RECOMMENDATION_CURSOR_STALE",
        message="The recommendation data changed; restart pagination",
    )
