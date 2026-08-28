"""Unit tests for the Redis chatbot state safety boundary."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any
from uuid import UUID

import pytest

from app.chat_store import (
    ChatSessionFenceLost,
    ChatStoreUnavailable,
    ChatTurn,
    RedisChatStore,
)

USER_ID = UUID("10000000-0000-4000-8000-000000000001")
OTHER_USER_ID = UUID("10000000-0000-4000-8000-000000000002")
SESSION_ID = UUID("20000000-0000-4000-8000-000000000001")
KEY_SECRET = "chat-store-test-key-secret-32-bytes-minimum"


class FakeRedis:
    def __init__(self) -> None:
        self.eval_results: list[Any] = []
        self.set_result: Any = True
        self.list_result: Any = []
        self.calls: list[tuple[Any, ...]] = []
        self.failure: Exception | None = None
        self.closed = False

    def eval(self, script: str, number_of_keys: int, *values: Any) -> Any:
        self.calls.append(("eval", script, number_of_keys, *values))
        self._raise_if_failed()
        if not self.eval_results:
            raise AssertionError("missing fake eval result")
        return self.eval_results.pop(0)

    def set(self, key: str, value: str, **options: Any) -> Any:
        self.calls.append(("set", key, value, options))
        self._raise_if_failed()
        return self.set_result

    def lrange(self, key: str, start: int, end: int) -> Any:
        self.calls.append(("lrange", key, start, end))
        self._raise_if_failed()
        return self.list_result

    def close(self) -> None:
        self.closed = True

    def _raise_if_failed(self) -> None:
        if self.failure is not None:
            raise self.failure


@pytest.fixture
def redis_client() -> FakeRedis:
    return FakeRedis()


@pytest.fixture
def store(redis_client: FakeRedis) -> RedisChatStore:
    return RedisChatStore(redis_client, key_secret=KEY_SECRET)  # type: ignore[arg-type]


def test_rate_limit_uses_atomic_server_time_and_pii_free_shared_slot(
    store: RedisChatStore,
    redis_client: FakeRedis,
) -> None:
    redis_client.eval_results.extend(([1, 0], [0, 7]))

    allowed = store.consume_rate(USER_ID)
    denied = store.consume_rate(USER_ID)

    assert allowed.allowed is True
    assert allowed.retry_after_seconds == 0
    assert denied.allowed is False
    assert denied.retry_after_seconds == 7
    first_call = redis_client.calls[0]
    assert first_call[:3] == ("eval", first_call[1], 2)
    assert "redis.call('TIME')" in first_call[1]
    user_key, global_key = first_call[3:5]
    assert user_key.split("}", 1)[0] == global_key.split("}", 1)[0]
    assert str(USER_ID) not in user_key
    assert str(USER_ID) not in global_key
    assert user_key != global_key


def test_session_keys_bind_user_and_session_without_exposing_identifiers(
    store: RedisChatStore,
    redis_client: FakeRedis,
) -> None:
    token = store.acquire_session(USER_ID, SESSION_ID)

    assert token is not None
    _, key, stored_token, options = redis_client.calls[-1]
    assert stored_token == token
    assert options == {"nx": True, "px": 30_000}
    assert str(USER_ID) not in key
    assert str(SESSION_ID) not in key

    redis_client.set_result = None
    assert store.acquire_session(USER_ID, SESSION_ID) is None

    other_key = store._session_keys(OTHER_USER_ID, SESSION_ID)[0]
    assert key.split("}", 1)[0] != other_key.split("}", 1)[0]


def test_append_is_fenced_trimmed_expiring_and_uses_same_hash_tag(
    store: RedisChatStore,
    redis_client: FakeRedis,
) -> None:
    redis_client.eval_results.append([1, 1])
    token = "t" * 43

    length = store.append_turn(
        USER_ID,
        SESSION_ID,
        token,
        ChatTurn("Xin chào", "Chào bạn"),
    )

    assert length == 1
    call = redis_client.calls[-1]
    assert call[0] == "eval"
    assert "redis.call('GET', KEYS[2]) ~= ARGV[1]" in call[1]
    assert "LTRIM" in call[1]
    assert "EXPIRE" in call[1]
    history_key, lock_key = call[3:5]
    assert history_key.split("}", 1)[0] == lock_key.split("}", 1)[0]
    assert str(USER_ID) not in history_key
    assert str(SESSION_ID) not in history_key
    assert call[5] == token
    assert json.loads(call[6]) == {
        "assistant_message": "Chào bạn",
        "user_message": "Xin chào",
    }
    assert call[7:] == (10, 86_400)


def test_stale_append_is_rejected_and_stale_release_is_compare_delete(
    store: RedisChatStore,
    redis_client: FakeRedis,
) -> None:
    token = "t" * 43
    redis_client.eval_results.extend(([0, 0], 0))

    with pytest.raises(ChatSessionFenceLost, match="ownership was lost"):
        store.append_turn(
            USER_ID,
            SESSION_ID,
            token,
            ChatTurn("question", "answer"),
        )

    store.release_session(USER_ID, SESSION_ID, token)
    release_call = redis_client.calls[-1]
    assert "redis.call('GET', KEYS[1]) == ARGV[1]" in release_call[1]
    assert release_call[-1] == token


def test_load_history_accepts_only_exact_bounded_json(
    store: RedisChatStore,
    redis_client: FakeRedis,
) -> None:
    redis_client.list_result = [
        b'{"assistant_message":"a1","user_message":"q1"}',
        '{"user_message":"q2","assistant_message":"a2"}',
    ]

    history = store.load_history(USER_ID, SESSION_ID)

    assert history == (
        ChatTurn("q1", "a1"),
        ChatTurn("q2", "a2"),
    )
    assert redis_client.calls[-1][-2:] == (0, 10)


@pytest.mark.parametrize(
    "serialized",
    [
        "not-json",
        "[]",
        '{"user_message":"q"}',
        '{"assistant_message":"a","user_message":"q","extra":1}',
        '{"assistant_message":"a","user_message":"q","user_message":"x"}',
        '{"assistant_message":1,"user_message":"q"}',
        '{"assistant_message":"a","user_message":""}',
    ],
)
def test_corrupt_history_fails_closed_without_echoing_content(
    store: RedisChatStore,
    redis_client: FakeRedis,
    serialized: str,
) -> None:
    redis_client.list_result = [serialized]

    with pytest.raises(ChatStoreUnavailable) as captured:
        store.load_history(USER_ID, SESSION_ID)

    assert str(captured.value) == "Chat state is unavailable"
    assert serialized not in str(captured.value)


def test_history_rejects_more_rows_than_configured_cap(
    redis_client: FakeRedis,
) -> None:
    store = RedisChatStore(
        redis_client,  # type: ignore[arg-type]
        key_secret=KEY_SECRET,
        max_turns=2,
    )
    redis_client.list_result = [
        '{"assistant_message":"a","user_message":"q"}',
    ] * 3

    with pytest.raises(ChatStoreUnavailable):
        store.load_history(USER_ID, SESSION_ID)


@pytest.mark.parametrize(
    "operation",
    [
        lambda store: store.consume_rate(USER_ID),
        lambda store: store.acquire_session(USER_ID, SESSION_ID),
        lambda store: store.load_history(USER_ID, SESSION_ID),
        lambda store: store.append_turn(
            USER_ID,
            SESSION_ID,
            "t" * 43,
            ChatTurn("q", "a"),
        ),
    ],
)
def test_redis_failures_are_sanitized_without_exception_chaining(
    redis_client: FakeRedis,
    store: RedisChatStore,
    operation: Callable[[RedisChatStore], object],
) -> None:
    private_failure = "redis://:raw-password@secret-host/private prompt"
    redis_client.failure = RuntimeError(private_failure)

    with pytest.raises(ChatStoreUnavailable) as captured:
        operation(store)

    assert str(captured.value) == "Chat state is unavailable"
    assert private_failure not in repr(captured.value)
    assert captured.value.__cause__ is None
    assert captured.value.__context__ is None


def test_release_is_best_effort_during_redis_outage(
    redis_client: FakeRedis,
    store: RedisChatStore,
) -> None:
    redis_client.failure = RuntimeError("private infrastructure details")

    store.release_session(USER_ID, SESSION_ID, "t" * 43)


def test_close_releases_redis_client() -> None:
    client = FakeRedis()
    store = RedisChatStore(client, key_secret=KEY_SECRET)  # type: ignore[arg-type]

    store.close()

    assert client.closed is True


@pytest.mark.parametrize(
    ("keyword", "value"),
    [
        ("history_ttl_seconds", 0),
        ("max_turns", 11),
        ("rate_window_seconds", 3_601),
        ("user_rate_limit", True),
        ("global_rate_limit", 9),
        ("lock_ttl_seconds", 301),
    ],
)
def test_store_configuration_is_bounded(
    redis_client: FakeRedis,
    keyword: str,
    value: object,
) -> None:
    arguments: dict[str, object] = {
        "key_secret": KEY_SECRET,
        "user_rate_limit": 10,
    }
    arguments[keyword] = value
    with pytest.raises(ValueError):
        RedisChatStore(redis_client, **arguments)  # type: ignore[arg-type]


def test_chat_turn_caps_do_not_echo_raw_messages() -> None:
    private_message = "secret" * 6_000

    with pytest.raises(ValueError) as captured:
        ChatTurn("question", private_message)

    assert str(captured.value) == "Chat turn is invalid"
    assert private_message not in str(captured.value)
