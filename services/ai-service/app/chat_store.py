"""Redis-backed, privacy-preserving chatbot state and rate limits."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, TypeVar, runtime_checkable
from urllib.parse import urlsplit
from uuid import UUID

from redis import Redis

_MAX_USER_MESSAGE_BYTES = 8 * 1024
_MAX_ASSISTANT_MESSAGE_BYTES = 32 * 1024
_MAX_SERIALIZED_TURN_BYTES = 48 * 1024
_MAX_HISTORY_BYTES = 480 * 1024
_REDIS_FAILURE = object()
_T = TypeVar("_T")


@dataclass(frozen=True, slots=True)
class ChatTurn:
    user_message: str
    assistant_message: str

    def __post_init__(self) -> None:
        _validate_message(
            self.user_message,
            maximum_bytes=_MAX_USER_MESSAGE_BYTES,
        )
        _validate_message(
            self.assistant_message,
            maximum_bytes=_MAX_ASSISTANT_MESSAGE_BYTES,
        )


@dataclass(frozen=True, slots=True)
class RateDecision:
    allowed: bool
    retry_after_seconds: int


class ChatStoreUnavailable(RuntimeError):
    """Raised when Redis state cannot be trusted or reached."""


class ChatSessionFenceLost(RuntimeError):
    """Raised when a caller no longer owns the session lease."""


@runtime_checkable
class ChatStore(Protocol):
    def consume_rate(self, user_id: UUID) -> RateDecision: ...

    def acquire_session(self, user_id: UUID, session_id: UUID) -> str | None: ...

    def renew_session(
        self,
        user_id: UUID,
        session_id: UUID,
        lock_token: str,
    ) -> None: ...

    def load_history(
        self,
        user_id: UUID,
        session_id: UUID,
    ) -> tuple[ChatTurn, ...]: ...

    def append_turn(
        self,
        user_id: UUID,
        session_id: UUID,
        lock_token: str,
        turn: ChatTurn,
    ) -> int: ...

    def release_session(
        self,
        user_id: UUID,
        session_id: UUID,
        lock_token: str,
    ) -> None: ...


_RATE_SCRIPT = """
local now = redis.call('TIME')
local now_ms = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
local window_ms = tonumber(ARGV[1])
local user_limit = tonumber(ARGV[2])
local global_limit = tonumber(ARGV[3])
local cutoff = now_ms - window_ms

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', cutoff)

local user_count = redis.call('ZCARD', KEYS[1])
local global_count = redis.call('ZCARD', KEYS[2])
if user_count >= user_limit or global_count >= global_limit then
  local retry_ms = 1
  if user_count >= user_limit then
    local oldest_user = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    if oldest_user[2] then
      retry_ms = math.max(retry_ms, tonumber(oldest_user[2]) + window_ms - now_ms)
    end
  end
  if global_count >= global_limit then
    local oldest_global = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
    if oldest_global[2] then
      retry_ms = math.max(retry_ms, tonumber(oldest_global[2]) + window_ms - now_ms)
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

_APPEND_SCRIPT = """
if redis.call('GET', KEYS[2]) ~= ARGV[1] then
  return {0, 0}
end
redis.call('RPUSH', KEYS[1], ARGV[2])
redis.call('LTRIM', KEYS[1], -tonumber(ARGV[3]), -1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return {1, redis.call('LLEN', KEYS[1])}
"""

_RELEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""

_RENEW_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return 0
"""


class RedisChatStore:
    """Stores bounded chat history and distributed limits in Redis."""

    def __init__(
        self,
        redis_client: Redis,
        *,
        key_secret: str,
        history_ttl_seconds: int = 86_400,
        max_turns: int = 10,
        rate_window_seconds: int = 60,
        user_rate_limit: int = 10,
        global_rate_limit: int = 200,
        lock_ttl_seconds: int = 30,
    ) -> None:
        self._redis = redis_client
        self._key_secret = _validate_key_secret(key_secret)
        self._history_ttl_seconds = _bounded_integer(
            history_ttl_seconds,
            name="history_ttl_seconds",
            minimum=1,
            maximum=86_400,
        )
        self._max_turns = _bounded_integer(
            max_turns,
            name="max_turns",
            minimum=1,
            maximum=10,
        )
        self._rate_window_seconds = _bounded_integer(
            rate_window_seconds,
            name="rate_window_seconds",
            minimum=1,
            maximum=3_600,
        )
        self._user_rate_limit = _bounded_integer(
            user_rate_limit,
            name="user_rate_limit",
            minimum=1,
            maximum=10_000,
        )
        self._global_rate_limit = _bounded_integer(
            global_rate_limit,
            name="global_rate_limit",
            minimum=self._user_rate_limit,
            maximum=100_000,
        )
        self._lock_ttl_seconds = _bounded_integer(
            lock_ttl_seconds,
            name="lock_ttl_seconds",
            minimum=1,
            maximum=300,
        )

    @classmethod
    def from_url(
        cls,
        redis_url: str,
        *,
        key_secret: str,
        history_ttl_seconds: int = 86_400,
        max_turns: int = 10,
        rate_window_seconds: int = 60,
        user_rate_limit: int = 10,
        global_rate_limit: int = 200,
        lock_ttl_seconds: int = 30,
        socket_connect_timeout_seconds: float = 2.0,
        socket_timeout_seconds: float = 2.0,
    ) -> RedisChatStore:
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
            history_ttl_seconds=history_ttl_seconds,
            max_turns=max_turns,
            rate_window_seconds=rate_window_seconds,
            user_rate_limit=user_rate_limit,
            global_rate_limit=global_rate_limit,
            lock_ttl_seconds=lock_ttl_seconds,
        )

    def close(self) -> None:
        _redis_operation(self._redis.close)

    def consume_rate(self, user_id: UUID) -> RateDecision:
        user_key, global_key = self._rate_keys(user_id)
        result = _redis_operation(
            lambda: self._redis.eval(
                _RATE_SCRIPT,
                2,
                user_key,
                global_key,
                self._rate_window_seconds * 1000,
                self._user_rate_limit,
                self._global_rate_limit,
                secrets.token_hex(16),
            )
        )
        if result is _REDIS_FAILURE:
            raise ChatStoreUnavailable("Chat state is unavailable")
        allowed, retry_after = _script_pair(result)
        if allowed == 1 and retry_after == 0:
            return RateDecision(allowed=True, retry_after_seconds=0)
        if allowed == 0 and 1 <= retry_after <= self._rate_window_seconds:
            return RateDecision(
                allowed=False,
                retry_after_seconds=retry_after,
            )
        raise ChatStoreUnavailable("Chat state is unavailable")

    def acquire_session(self, user_id: UUID, session_id: UUID) -> str | None:
        _, lock_key = self._session_keys(user_id, session_id)
        token = secrets.token_urlsafe(32)
        result = _redis_operation(
            lambda: self._redis.set(
                lock_key,
                token,
                nx=True,
                px=self._lock_ttl_seconds * 1000,
            )
        )
        if result is _REDIS_FAILURE:
            raise ChatStoreUnavailable("Chat state is unavailable")
        if result is None or result is False:
            return None
        if result is not True and result not in ("OK", b"OK"):
            raise ChatStoreUnavailable("Chat state is unavailable")
        return token

    def load_history(
        self,
        user_id: UUID,
        session_id: UUID,
    ) -> tuple[ChatTurn, ...]:
        history_key, _ = self._session_keys(user_id, session_id)
        result = _redis_operation(
            lambda: self._redis.lrange(history_key, 0, self._max_turns)
        )
        if result is _REDIS_FAILURE or not isinstance(result, list | tuple):
            raise ChatStoreUnavailable("Chat state is unavailable")
        if len(result) > self._max_turns:
            raise ChatStoreUnavailable("Chat state is unavailable")

        turns: list[ChatTurn] = []
        total_bytes = 0
        for raw_turn in result:
            if isinstance(raw_turn, bytes):
                try:
                    serialized = raw_turn.decode("utf-8", errors="strict")
                except UnicodeDecodeError:
                    raise ChatStoreUnavailable("Chat state is unavailable") from None
            elif isinstance(raw_turn, str):
                serialized = raw_turn
            else:
                raise ChatStoreUnavailable("Chat state is unavailable")
            try:
                serialized_bytes = serialized.encode("utf-8")
            except UnicodeEncodeError:
                raise ChatStoreUnavailable("Chat state is unavailable") from None
            if len(serialized_bytes) > _MAX_SERIALIZED_TURN_BYTES:
                raise ChatStoreUnavailable("Chat state is unavailable")
            total_bytes += len(serialized_bytes)
            if total_bytes > _MAX_HISTORY_BYTES:
                raise ChatStoreUnavailable("Chat state is unavailable")
            turns.append(_decode_turn(serialized))
        return tuple(turns)

    def renew_session(
        self,
        user_id: UUID,
        session_id: UUID,
        lock_token: str,
    ) -> None:
        token = _validate_lock_token(lock_token)
        _, lock_key = self._session_keys(user_id, session_id)
        result = _redis_operation(
            lambda: self._redis.eval(
                _RENEW_SCRIPT,
                1,
                lock_key,
                token,
                self._lock_ttl_seconds * 1000,
            )
        )
        if result is _REDIS_FAILURE:
            raise ChatStoreUnavailable("Chat state is unavailable")
        if result == 1:
            return
        if result == 0:
            raise ChatSessionFenceLost("Chat session ownership was lost")
        raise ChatStoreUnavailable("Chat state is unavailable")

    def append_turn(
        self,
        user_id: UUID,
        session_id: UUID,
        lock_token: str,
        turn: ChatTurn,
    ) -> int:
        token = _validate_lock_token(lock_token)
        if not isinstance(turn, ChatTurn):
            raise ValueError("turn is invalid")
        serialized = _encode_turn(turn)
        history_key, lock_key = self._session_keys(user_id, session_id)
        result = _redis_operation(
            lambda: self._redis.eval(
                _APPEND_SCRIPT,
                2,
                history_key,
                lock_key,
                token,
                serialized,
                self._max_turns,
                self._history_ttl_seconds,
            )
        )
        if result is _REDIS_FAILURE:
            raise ChatStoreUnavailable("Chat state is unavailable")
        appended, history_length = _script_pair(result)
        if appended == 0 and history_length == 0:
            raise ChatSessionFenceLost("Chat session ownership was lost")
        if appended != 1 or not 1 <= history_length <= self._max_turns:
            raise ChatStoreUnavailable("Chat state is unavailable")
        return history_length

    def release_session(
        self,
        user_id: UUID,
        session_id: UUID,
        lock_token: str,
    ) -> None:
        try:
            token = _validate_lock_token(lock_token)
            _, lock_key = self._session_keys(user_id, session_id)
        except ValueError:
            return
        _redis_operation(
            lambda: self._redis.eval(
                _RELEASE_SCRIPT,
                1,
                lock_key,
                token,
            )
        )

    def _rate_keys(self, user_id: UUID) -> tuple[str, str]:
        canonical_user = _canonical_uuid(user_id, name="user_id")
        user_digest = self._digest("rate-user-v1", canonical_user)
        global_digest = self._digest("rate-global-v1")
        slot_digest = self._digest("rate-slot-v1")
        prefix = f"ai:chat:{{{slot_digest}}}:rate"
        return (
            f"{prefix}:user:{user_digest}",
            f"{prefix}:global:{global_digest}",
        )

    def _session_keys(
        self,
        user_id: UUID,
        session_id: UUID,
    ) -> tuple[str, str]:
        canonical_user = _canonical_uuid(user_id, name="user_id")
        canonical_session = _canonical_uuid(session_id, name="session_id")
        digest = self._digest(
            "session-v1",
            canonical_user,
            canonical_session,
        )
        prefix = f"ai:chat:{{{digest}}}"
        return f"{prefix}:history", f"{prefix}:lock"

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


def _canonical_uuid(value: UUID, *, name: str) -> str:
    if not isinstance(value, UUID):
        raise ValueError(f"{name} is invalid")
    return str(value)


def _validate_message(value: str, *, maximum_bytes: int) -> None:
    if not isinstance(value, str):
        raise ValueError("Chat turn is invalid")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("Chat turn is invalid") from None
    if not encoded or len(encoded) > maximum_bytes or "\x00" in value:
        raise ValueError("Chat turn is invalid")


def _validate_lock_token(value: str) -> str:
    if (
        not isinstance(value, str)
        or not 32 <= len(value) <= 128
        or not value.isascii()
        or any(not (character.isalnum() or character in "-_") for character in value)
    ):
        raise ValueError("lock_token is invalid")
    return value


def _encode_turn(turn: ChatTurn) -> str:
    serialized = json.dumps(
        {
            "assistant_message": turn.assistant_message,
            "user_message": turn.user_message,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    if len(serialized.encode("utf-8")) > _MAX_SERIALIZED_TURN_BYTES:
        raise ValueError("Chat turn is invalid")
    return serialized


def _decode_turn(serialized: str) -> ChatTurn:
    try:
        value = json.loads(
            serialized,
            object_pairs_hook=_exact_object,
            parse_constant=_reject_json_constant,
        )
        if not isinstance(value, dict) or set(value) != {
            "assistant_message",
            "user_message",
        }:
            raise ValueError
        return ChatTurn(
            user_message=value["user_message"],
            assistant_message=value["assistant_message"],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise ChatStoreUnavailable("Chat state is unavailable") from None


def _exact_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _reject_json_constant(_: str) -> None:
    raise ValueError


def _script_pair(value: Any) -> tuple[int, int]:
    if not isinstance(value, list | tuple) or len(value) != 2:
        raise ChatStoreUnavailable("Chat state is unavailable")
    first, second = value
    if (
        isinstance(first, bool)
        or isinstance(second, bool)
        or not isinstance(first, int)
        or not isinstance(second, int)
    ):
        raise ChatStoreUnavailable("Chat state is unavailable")
    return first, second
