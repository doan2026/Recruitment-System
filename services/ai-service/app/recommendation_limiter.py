"""Redis-backed distributed rate limits for the recommendation surfaces.

The recommendation endpoints are internal and already authenticate the calling
service, so the limiter does not protect against an unauthenticated flood. It
bounds how much vector-store work a single subject can cause across every
replica: one CV looping ``/recommend/jobs`` or one Job looping
``/recommend/candidates`` — through a retry storm, a stuck client, or an
abusive Candidate driving the Job service — cannot monopolise the shared
pgvector capacity.

Counting lives in Redis rather than in process memory precisely because the
service runs multiple replicas: a per-process limiter would multiply the real
budget by the replica count and drift as replicas scale.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol, TypeVar, runtime_checkable
from urllib.parse import urlsplit
from uuid import UUID

from redis import Redis

_REDIS_FAILURE = object()
_T = TypeVar("_T")


class RecommendationSurface(Enum):
    """The rate-limited recommendation surfaces.

    Each surface keeps its own subject and global budget so a burst on one
    cannot starve the other.
    """

    JOBS = "jobs"
    CANDIDATES = "candidates"


@dataclass(frozen=True, slots=True)
class RateDecision:
    allowed: bool
    retry_after_seconds: int


class RecommendationLimiterUnavailable(RuntimeError):
    """Raised when the distributed limit cannot be trusted or reached."""


@runtime_checkable
class RecommendationLimiter(Protocol):
    def consume(
        self,
        surface: RecommendationSurface,
        subject_id: UUID,
    ) -> RateDecision: ...


# Redis server TIME is the only clock, so replicas with skewed system clocks
# still share one window. Reads, the limit check and the write happen inside a
# single script, so two replicas cannot both observe a free slot and take it.
_RATE_SCRIPT = """
local now = redis.call('TIME')
local now_ms = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
local window_ms = tonumber(ARGV[1])
local subject_limit = tonumber(ARGV[2])
local global_limit = tonumber(ARGV[3])
local cutoff = now_ms - window_ms

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', cutoff)

local subject_count = redis.call('ZCARD', KEYS[1])
local global_count = redis.call('ZCARD', KEYS[2])
if subject_count >= subject_limit or global_count >= global_limit then
  local retry_ms = 1
  if subject_count >= subject_limit then
    local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    if oldest[2] then
      retry_ms = math.max(retry_ms, tonumber(oldest[2]) + window_ms - now_ms)
    end
  end
  if global_count >= global_limit then
    local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
    if oldest[2] then
      retry_ms = math.max(retry_ms, tonumber(oldest[2]) + window_ms - now_ms)
    end
  end
  return {0, math.max(1, math.ceil(retry_ms / 1000))}
end

local member = tostring(now[1]) .. ':' .. tostring(now[2]) .. ':' .. ARGV[4]
redis.call('ZADD', KEYS[1], now_ms, member)
redis.call('ZADD', KEYS[2], now_ms, member)
redis.call('PEXPIRE', KEYS[1], window_ms + 1000)
redis.call('PEXPIRE', KEYS[2], window_ms + 1000)
return {1, 0}
"""


class RedisRecommendationLimiter:
    """Distributed sliding-window limits for the recommendation surfaces."""

    def __init__(
        self,
        redis_client: Redis,
        *,
        key_secret: str,
        window_seconds: int = 60,
        subject_limit: int = 30,
        global_limit: int = 600,
    ) -> None:
        self._redis = redis_client
        self._key_secret = _validate_key_secret(key_secret)
        self._window_seconds = _bounded_integer(
            window_seconds,
            name="window_seconds",
            minimum=1,
            maximum=3_600,
        )
        self._subject_limit = _bounded_integer(
            subject_limit,
            name="subject_limit",
            minimum=1,
            maximum=10_000,
        )
        self._global_limit = _bounded_integer(
            global_limit,
            name="global_limit",
            minimum=self._subject_limit,
            maximum=1_000_000,
        )

    @classmethod
    def from_url(
        cls,
        redis_url: str,
        *,
        key_secret: str,
        window_seconds: int = 60,
        subject_limit: int = 30,
        global_limit: int = 600,
        socket_connect_timeout_seconds: float = 2.0,
        socket_timeout_seconds: float = 2.0,
    ) -> RedisRecommendationLimiter:
        parsed_url = urlsplit(redis_url)
        if (
            parsed_url.scheme not in {"redis", "rediss"}
            or not parsed_url.hostname
            or parsed_url.fragment
            or parsed_url.query
        ):
            raise ValueError("redis_url is invalid")
        connect_timeout = _bounded_timeout(socket_connect_timeout_seconds)
        socket_timeout = _bounded_timeout(socket_timeout_seconds)
        client_result: Redis | object
        try:
            client_result = Redis.from_url(
                redis_url,
                decode_responses=True,
                encoding="utf-8",
                encoding_errors="strict",
                socket_connect_timeout=connect_timeout,
                socket_timeout=socket_timeout,
                retry_on_timeout=False,
                health_check_interval=30,
            )
        except Exception:
            client_result = _REDIS_FAILURE
        if client_result is _REDIS_FAILURE:
            raise ValueError("redis_url is invalid")
        return cls(
            client_result,
            key_secret=key_secret,
            window_seconds=window_seconds,
            subject_limit=subject_limit,
            global_limit=global_limit,
        )

    def close(self) -> None:
        _redis_operation(self._redis.close)

    def consume(
        self,
        surface: RecommendationSurface,
        subject_id: UUID,
    ) -> RateDecision:
        subject_key, global_key = self._rate_keys(surface, subject_id)
        result = _redis_operation(
            lambda: self._redis.eval(
                _RATE_SCRIPT,
                2,
                subject_key,
                global_key,
                self._window_seconds * 1000,
                self._subject_limit,
                self._global_limit,
                secrets.token_hex(16),
            )
        )
        # Fail closed: an unreachable or unexpected Redis means the shared
        # budget is unknown, and silently serving would let every replica run
        # unbounded exactly when the dependency is already unhealthy.
        if result is _REDIS_FAILURE:
            raise RecommendationLimiterUnavailable(
                "Recommendation limits are unavailable"
            )
        allowed, retry_after = _script_pair(result)
        if allowed == 1 and retry_after == 0:
            return RateDecision(allowed=True, retry_after_seconds=0)
        if allowed == 0 and 1 <= retry_after <= self._window_seconds:
            return RateDecision(allowed=False, retry_after_seconds=retry_after)
        raise RecommendationLimiterUnavailable("Recommendation limits are unavailable")

    def _rate_keys(
        self,
        surface: RecommendationSurface,
        subject_id: UUID,
    ) -> tuple[str, str]:
        # Keys carry HMAC digests, never a raw cv_id/job_id, so Redis holds no
        # identifier that would link a subject to its recommendation traffic.
        canonical_surface = _canonical_surface(surface)
        canonical_subject = _canonical_uuid(subject_id, name="subject_id")
        subject_digest = self._digest(
            "recommend-subject-v1",
            canonical_surface,
            canonical_subject,
        )
        global_digest = self._digest("recommend-global-v1", canonical_surface)
        # Both keys of one surface share a hash tag so a Redis Cluster keeps
        # them in the same slot and the script stays single-slot.
        slot_digest = self._digest("recommend-slot-v1", canonical_surface)
        prefix = f"ai:recommend:{{{slot_digest}}}:{canonical_surface}"
        return (
            f"{prefix}:subject:{subject_digest}",
            f"{prefix}:global:{global_digest}",
        )

    def _digest(self, purpose: str, *values: str) -> str:
        keyed = hmac.new(self._key_secret, digestmod=hashlib.sha256)
        for value in (purpose, *values):
            encoded = value.encode("ascii")
            keyed.update(len(encoded).to_bytes(4, byteorder="big"))
            keyed.update(encoded)
        return keyed.hexdigest()


def _redis_operation(operation: Callable[[], _T]) -> _T | object:
    try:
        return operation()
    except Exception:
        return _REDIS_FAILURE


def _script_pair(result: Any) -> tuple[int, int]:
    if not isinstance(result, list) or len(result) != 2:
        raise RecommendationLimiterUnavailable("Recommendation limits are unavailable")
    values: list[int] = []
    for item in result:
        if isinstance(item, bool) or not isinstance(item, int):
            raise RecommendationLimiterUnavailable(
                "Recommendation limits are unavailable"
            )
        values.append(item)
    return values[0], values[1]


def _validate_key_secret(value: str) -> bytes:
    if not isinstance(value, str):
        raise ValueError("key_secret is invalid")
    try:
        encoded = value.encode("ascii")
    except UnicodeEncodeError:
        raise ValueError("key_secret is invalid") from None
    if not 32 <= len(encoded) <= 512 or any(
        byte < 0x21 or byte > 0x7E for byte in encoded
    ):
        raise ValueError("key_secret is invalid")
    return encoded


def _bounded_integer(
    value: int,
    *,
    name: str,
    minimum: int,
    maximum: int,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} is invalid")
    if value < minimum or value > maximum:
        raise ValueError(f"{name} is invalid")
    return value


def _bounded_timeout(value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError("Redis socket timeout is invalid")
    timeout = float(value)
    if not math.isfinite(timeout) or not 0.1 <= timeout <= 10.0:
        raise ValueError("Redis socket timeout is invalid")
    return timeout


def _canonical_surface(value: RecommendationSurface) -> str:
    if not isinstance(value, RecommendationSurface):
        raise ValueError("surface is invalid")
    return value.value


def _canonical_uuid(value: UUID, *, name: str) -> str:
    if not isinstance(value, UUID):
        raise ValueError(f"{name} is invalid")
    return str(value)
