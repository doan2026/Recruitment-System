"""Runtime configuration for the AI Service."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
_MODEL_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$")


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    internal_api_key: str
    internal_api_key_job_search: str = ""
    internal_api_key_job_search_candidates: str = ""
    database_connect_timeout_seconds: int = 2
    database_statement_timeout_ms: int = 2_000
    chat_enabled: bool = False
    redis_url: str = ""
    chat_redis_key_secret: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = DEFAULT_ANTHROPIC_MODEL
    chat_provider_timeout_seconds: int = 15
    chat_max_output_tokens: int = 512
    chat_history_ttl_seconds: int = 86_400
    chat_history_max_turns: int = 10
    chat_rate_window_seconds: int = 60
    chat_user_rate_limit: int = 10
    chat_global_rate_limit: int = 200
    chat_session_lock_seconds: int = 30
    chat_max_concurrent_requests: int = 8
    chat_recommendation_tool_enabled: bool = False
    recommendation_rate_limit_enabled: bool = False
    recommendation_redis_key_secret: str = ""
    recommendation_rate_window_seconds: int = 60
    recommendation_subject_rate_limit: int = 30
    recommendation_global_rate_limit: int = 600
    chat_job_recommendation_url: str = ""
    chat_job_service_allowed_hosts: tuple[str, ...] = ()
    chat_job_service_allow_insecure_http: bool = False
    chat_job_request_timeout_seconds: int = 3
    jwt_issuer: str = ""
    jwt_audience: str = ""
    jwt_jwks_uri: str = ""
    jwt_jwks_allowed_hosts: tuple[str, ...] = ()
    jwt_allow_insecure_jwks: bool = False
    jwt_jwks_timeout_seconds: int = 3
    jwt_jwks_cache_ttl_seconds: int = 300

    @classmethod
    def from_environment(cls) -> Settings:
        return cls(
            database_url=os.getenv("DATABASE_URL", "").strip(),
            internal_api_key=os.getenv("INTERNAL_API_KEY", "").strip(),
            internal_api_key_job_search=os.getenv(
                "INTERNAL_API_KEY_JOB_SEARCH",
                "",
            ),
            internal_api_key_job_search_candidates=os.getenv(
                "INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES",
                "",
            ),
            database_connect_timeout_seconds=_positive_int(
                "DATABASE_CONNECT_TIMEOUT_SECONDS",
                default=2,
            ),
            database_statement_timeout_ms=_positive_int(
                "DATABASE_STATEMENT_TIMEOUT_MS",
                default=2_000,
            ),
            chat_enabled=_boolean("CHAT_ENABLED", default=False),
            redis_url=os.getenv("REDIS_URL", "").strip(),
            chat_redis_key_secret=os.getenv(
                "CHAT_REDIS_KEY_SECRET",
                "",
            ).strip(),
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip(),
            anthropic_model=os.getenv(
                "ANTHROPIC_MODEL",
                DEFAULT_ANTHROPIC_MODEL,
            ).strip(),
            chat_provider_timeout_seconds=_bounded_int(
                "CHAT_PROVIDER_TIMEOUT_SECONDS",
                default=15,
                minimum=2,
                maximum=30,
            ),
            chat_max_output_tokens=_bounded_int(
                "CHAT_MAX_OUTPUT_TOKENS",
                default=512,
                minimum=64,
                maximum=1_024,
            ),
            chat_history_ttl_seconds=_bounded_int(
                "CHAT_HISTORY_TTL_SECONDS",
                default=86_400,
                minimum=3_600,
                maximum=86_400,
            ),
            chat_history_max_turns=_bounded_int(
                "CHAT_HISTORY_MAX_TURNS",
                default=10,
                minimum=1,
                maximum=10,
            ),
            chat_rate_window_seconds=_bounded_int(
                "CHAT_RATE_WINDOW_SECONDS",
                default=60,
                minimum=10,
                maximum=3_600,
            ),
            chat_user_rate_limit=_bounded_int(
                "CHAT_USER_RATE_LIMIT",
                default=10,
                minimum=1,
                maximum=120,
            ),
            chat_global_rate_limit=_bounded_int(
                "CHAT_GLOBAL_RATE_LIMIT",
                default=200,
                minimum=1,
                maximum=10_000,
            ),
            chat_session_lock_seconds=_bounded_int(
                "CHAT_SESSION_LOCK_SECONDS",
                default=30,
                minimum=5,
                maximum=60,
            ),
            chat_max_concurrent_requests=_bounded_int(
                "CHAT_MAX_CONCURRENT_REQUESTS",
                default=8,
                minimum=1,
                maximum=32,
            ),
            chat_recommendation_tool_enabled=_boolean(
                "CHAT_RECOMMENDATION_TOOL_ENABLED",
                default=False,
            ),
            recommendation_rate_limit_enabled=_boolean(
                "RECOMMENDATION_RATE_LIMIT_ENABLED",
                default=False,
            ),
            recommendation_redis_key_secret=os.getenv(
                "RECOMMENDATION_REDIS_KEY_SECRET",
                "",
            ).strip(),
            recommendation_rate_window_seconds=_bounded_int(
                "RECOMMENDATION_RATE_WINDOW_SECONDS",
                default=60,
                minimum=10,
                maximum=3_600,
            ),
            recommendation_subject_rate_limit=_bounded_int(
                "RECOMMENDATION_SUBJECT_RATE_LIMIT",
                default=30,
                minimum=1,
                maximum=1_000,
            ),
            recommendation_global_rate_limit=_bounded_int(
                "RECOMMENDATION_GLOBAL_RATE_LIMIT",
                default=600,
                minimum=1,
                maximum=100_000,
            ),
            chat_job_recommendation_url=os.getenv(
                "CHAT_JOB_RECOMMENDATION_URL",
                "",
            ).strip(),
            chat_job_service_allowed_hosts=_csv("CHAT_JOB_SERVICE_ALLOWED_HOSTS"),
            chat_job_service_allow_insecure_http=_boolean(
                "CHAT_JOB_SERVICE_ALLOW_INSECURE_HTTP",
                default=False,
            ),
            chat_job_request_timeout_seconds=_bounded_int(
                "CHAT_JOB_REQUEST_TIMEOUT_SECONDS",
                default=3,
                minimum=1,
                maximum=5,
            ),
            jwt_issuer=os.getenv("JWT_ISSUER", "").strip(),
            jwt_audience=os.getenv("JWT_AUDIENCE", "").strip(),
            jwt_jwks_uri=os.getenv("JWT_JWKS_URI", "").strip(),
            jwt_jwks_allowed_hosts=_csv("JWT_JWKS_ALLOWED_HOSTS"),
            jwt_allow_insecure_jwks=_boolean(
                "JWT_ALLOW_INSECURE_JWKS",
                default=False,
            ),
            jwt_jwks_timeout_seconds=_bounded_int(
                "JWT_JWKS_TIMEOUT_SECONDS",
                default=3,
                minimum=1,
                maximum=10,
            ),
            jwt_jwks_cache_ttl_seconds=_bounded_int(
                "JWT_JWKS_CACHE_TTL_SECONDS",
                default=300,
                minimum=30,
                maximum=3_600,
            ),
        )

    def validate(self) -> None:
        if not self.database_url:
            raise RuntimeError("DATABASE_URL must be configured")
        if not self.internal_api_key:
            raise RuntimeError("INTERNAL_API_KEY must be configured")
        if not self.internal_api_key_job_search:
            raise RuntimeError("INTERNAL_API_KEY_JOB_SEARCH must be configured")
        self._validate_scoped_key(
            "INTERNAL_API_KEY_JOB_SEARCH",
            self.internal_api_key_job_search,
        )
        self._validate_scoped_key(
            "INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES",
            self.internal_api_key_job_search_candidates,
        )
        if self.internal_api_key_job_search == self.internal_api_key:
            raise RuntimeError(
                "INTERNAL_API_KEY_JOB_SEARCH must differ from INTERNAL_API_KEY"
            )
        if self.internal_api_key_job_search_candidates in {
            self.internal_api_key,
            self.internal_api_key_job_search,
        }:
            raise RuntimeError(
                "INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES must be distinct"
            )
        if self.chat_enabled:
            self._validate_chat()
        if self.recommendation_rate_limit_enabled:
            self._validate_recommendation_rate_limit()

    def _validate_recommendation_rate_limit(self) -> None:
        parsed_redis = urlsplit(self.redis_url)
        if (
            parsed_redis.scheme not in {"redis", "rediss"}
            or not parsed_redis.hostname
            or parsed_redis.password is None
            or parsed_redis.fragment
        ):
            raise RuntimeError("REDIS_URL is invalid for recommendation limits")
        self._validate_secret(
            "RECOMMENDATION_REDIS_KEY_SECRET",
            self.recommendation_redis_key_secret,
        )
        # A shared secret would make the chat and recommendation key spaces
        # derivable from one another; keep the namespaces independent.
        if self.recommendation_redis_key_secret == self.chat_redis_key_secret:
            raise RuntimeError(
                "RECOMMENDATION_REDIS_KEY_SECRET must differ from "
                "CHAT_REDIS_KEY_SECRET"
            )
        if self.recommendation_global_rate_limit < (
            self.recommendation_subject_rate_limit
        ):
            raise RuntimeError(
                "RECOMMENDATION_GLOBAL_RATE_LIMIT must not be below "
                "RECOMMENDATION_SUBJECT_RATE_LIMIT"
            )

    def _validate_chat(self) -> None:
        parsed_redis = urlsplit(self.redis_url)
        if (
            parsed_redis.scheme not in {"redis", "rediss"}
            or not parsed_redis.hostname
            or parsed_redis.password is None
            or parsed_redis.fragment
        ):
            raise RuntimeError("REDIS_URL is invalid for chat")
        self._validate_secret("CHAT_REDIS_KEY_SECRET", self.chat_redis_key_secret)
        self._validate_secret("ANTHROPIC_API_KEY", self.anthropic_api_key)
        if not _MODEL_PATTERN.fullmatch(self.anthropic_model):
            raise RuntimeError("ANTHROPIC_MODEL is invalid")
        if not self.jwt_issuer or len(self.jwt_issuer) > 512:
            raise RuntimeError("JWT_ISSUER is invalid for chat")
        if not self.jwt_audience or len(self.jwt_audience) > 512:
            raise RuntimeError("JWT_AUDIENCE is invalid for chat")
        if not self.jwt_jwks_uri or not self.jwt_jwks_allowed_hosts:
            raise RuntimeError("JWT JWKS configuration is required for chat")
        if self.chat_global_rate_limit < self.chat_user_rate_limit:
            raise RuntimeError(
                "CHAT_GLOBAL_RATE_LIMIT must not be below CHAT_USER_RATE_LIMIT"
            )
        lock_budget = self.chat_provider_timeout_seconds + 5
        if self.chat_recommendation_tool_enabled:
            self._validate_chat_job_endpoint()
            lock_budget += self.chat_job_request_timeout_seconds
        if self.chat_session_lock_seconds < lock_budget:
            raise RuntimeError(
                "CHAT_SESSION_LOCK_SECONDS is below the external-call safety budget"
            )

    def _validate_chat_job_endpoint(self) -> None:
        endpoint = self.chat_job_recommendation_url
        if (
            not endpoint
            or any(
                ord(character) < 0x21 or ord(character) > 0x7E for character in endpoint
            )
            or "%" in endpoint
            or "\\" in endpoint
        ):
            raise RuntimeError("CHAT_JOB_RECOMMENDATION_URL is invalid")
        try:
            parsed = urlsplit(endpoint)
            port = parsed.port
        except ValueError as error:
            raise RuntimeError("CHAT_JOB_RECOMMENDATION_URL is invalid") from error
        hostname = parsed.hostname
        allowed_hosts = self.chat_job_service_allowed_hosts
        if any(not _valid_hostname(host) for host in allowed_hosts):
            raise RuntimeError("CHAT_JOB_SERVICE_ALLOWED_HOSTS is invalid")
        if (
            parsed.scheme not in {"http", "https"}
            or (
                parsed.scheme == "http"
                and not self.chat_job_service_allow_insecure_http
            )
            or hostname is None
            or hostname != hostname.lower()
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path != "/recommended"
            or parsed.query
            or parsed.fragment
            or not allowed_hosts
            or hostname not in allowed_hosts
        ):
            raise RuntimeError("CHAT_JOB_RECOMMENDATION_URL is invalid")
        expected_netloc = hostname if port is None else f"{hostname}:{port}"
        if parsed.netloc != expected_netloc:
            raise RuntimeError("CHAT_JOB_RECOMMENDATION_URL is invalid")

    @staticmethod
    def _validate_secret(name: str, value: str) -> None:
        try:
            encoded = value.encode("ascii")
        except UnicodeEncodeError as error:
            raise RuntimeError(f"{name} is invalid") from error
        if (
            not 32 <= len(encoded) <= 512
            or b"replace-with" in encoded.lower()
            or any(byte < 0x21 or byte > 0x7E for byte in encoded)
        ):
            raise RuntimeError(f"{name} is invalid")

    @staticmethod
    def _validate_scoped_key(name: str, value: str) -> None:
        try:
            key_bytes = value.encode("ascii")
        except UnicodeEncodeError as error:
            raise RuntimeError(f"{name} is invalid") from error
        if (
            not 32 <= len(key_bytes) <= 512
            or b"replace-with" in key_bytes.lower()
            or any(byte < 0x21 or byte > 0x7E for byte in key_bytes)
        ):
            raise RuntimeError(f"{name} is invalid")


def _positive_int(name: str, *, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


def _bounded_int(
    name: str,
    *,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    value = _positive_int(name, default=default)
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _boolean(name: str, *, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    normalized = raw_value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise RuntimeError(f"{name} must be true or false")


def _csv(name: str) -> tuple[str, ...]:
    raw_value = os.getenv(name, "")
    values = tuple(
        part.strip().lower() for part in raw_value.split(",") if part.strip()
    )
    if len(values) != len(set(values)):
        raise RuntimeError(f"{name} contains duplicate values")
    return values


def _valid_hostname(hostname: str) -> bool:
    if (
        not hostname
        or len(hostname) > 253
        or hostname.startswith((".", "-"))
        or hostname.endswith((".", "-"))
        or ".." in hostname
    ):
        return False
    return all(
        label
        and len(label) <= 63
        and not label.startswith("-")
        and not label.endswith("-")
        and all(
            character.isascii() and (character.isalnum() or character == "-")
            for character in label
        )
        for label in hostname.split(".")
    )
