"""Real Redis integration tests for chatbot history, limits and fencing."""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from redis import Redis

from app.chat_store import ChatSessionFenceLost, ChatTurn, RedisChatStore

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def clean_embedding_tables() -> None:
    """Override the PostgreSQL-only integration fixture for this Redis suite."""


@pytest.fixture
def redis_url() -> str:
    value = os.getenv("AI_TEST_REDIS_URL", "").strip()
    if not value:
        pytest.skip("AI_TEST_REDIS_URL is required for Redis integration tests")
    return value


@pytest.fixture
def redis_client(redis_url: str) -> Redis:
    client = Redis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
    )
    client.ping()
    return client


def _store(
    redis_url: str,
    *,
    key_secret: str,
    history_ttl_seconds: int = 30,
    max_turns: int = 10,
    rate_window_seconds: int = 2,
    user_rate_limit: int = 2,
    global_rate_limit: int = 100,
    lock_ttl_seconds: int = 2,
) -> RedisChatStore:
    return RedisChatStore.from_url(
        redis_url,
        key_secret=key_secret,
        history_ttl_seconds=history_ttl_seconds,
        max_turns=max_turns,
        rate_window_seconds=rate_window_seconds,
        user_rate_limit=user_rate_limit,
        global_rate_limit=global_rate_limit,
        lock_ttl_seconds=lock_ttl_seconds,
    )


def _delete_store_keys(
    client: Redis,
    store: RedisChatStore,
    user_ids: tuple[UUID, ...],
    session_ids: tuple[UUID, ...],
) -> None:
    keys: set[str] = set()
    for user_id in user_ids:
        keys.update(store._rate_keys(user_id))
        for session_id in session_ids:
            keys.update(store._session_keys(user_id, session_id))
    if keys:
        client.delete(*keys)


def test_history_keeps_ten_turns_refreshes_ttl_and_isolates_owner(
    redis_url: str,
    redis_client: Redis,
) -> None:
    user_id, other_user_id, session_id = uuid4(), uuid4(), uuid4()
    store = _store(
        redis_url,
        key_secret="history-integration-secret-key-000001",
        history_ttl_seconds=2,
    )
    _delete_store_keys(
        redis_client,
        store,
        (user_id, other_user_id),
        (session_id,),
    )
    try:
        token = store.acquire_session(user_id, session_id)
        assert token is not None
        for index in range(12):
            assert store.append_turn(
                user_id,
                session_id,
                token,
                ChatTurn(f"question-{index}", f"answer-{index}"),
            ) == min(index + 1, 10)

        history = store.load_history(user_id, session_id)
        assert len(history) == 10
        assert history[0] == ChatTurn("question-2", "answer-2")
        assert history[-1] == ChatTurn("question-11", "answer-11")
        assert store.load_history(other_user_id, session_id) == ()
        history_key = store._session_keys(user_id, session_id)[0]
        assert 0 < redis_client.ttl(history_key) <= 2

        time.sleep(2.1)
        assert store.load_history(user_id, session_id) == ()
    finally:
        _delete_store_keys(
            redis_client,
            store,
            (user_id, other_user_id),
            (session_id,),
        )


def test_user_rate_limit_cannot_be_bypassed_with_new_sessions(
    redis_url: str,
    redis_client: Redis,
) -> None:
    user_id = uuid4()
    sessions = tuple(uuid4() for _ in range(4))
    store = _store(
        redis_url,
        key_secret="user-rate-integration-secret-key-0001",
        user_rate_limit=2,
    )
    _delete_store_keys(redis_client, store, (user_id,), sessions)
    try:
        decisions = []
        for session_id in sessions[:3]:
            token = store.acquire_session(user_id, session_id)
            assert token is not None
            decisions.append(store.consume_rate(user_id))
            store.release_session(user_id, session_id, token)

        assert [decision.allowed for decision in decisions] == [True, True, False]
        assert 1 <= decisions[-1].retry_after_seconds <= 2
    finally:
        _delete_store_keys(redis_client, store, (user_id,), sessions)


def test_global_rate_limit_is_shared_across_users(
    redis_url: str,
    redis_client: Redis,
) -> None:
    users = (uuid4(), uuid4(), uuid4())
    session_id = uuid4()
    store = _store(
        redis_url,
        key_secret="global-rate-integration-secret-key-001",
        user_rate_limit=2,
        global_rate_limit=2,
    )
    _delete_store_keys(redis_client, store, users, (session_id,))
    try:
        decisions = [store.consume_rate(user_id) for user_id in users]

        assert [decision.allowed for decision in decisions] == [True, True, False]
        assert 1 <= decisions[-1].retry_after_seconds <= 2
    finally:
        _delete_store_keys(redis_client, store, users, (session_id,))


def test_concurrent_lock_fences_old_owner_and_release_cannot_delete_new_lock(
    redis_url: str,
    redis_client: Redis,
) -> None:
    user_id, session_id = uuid4(), uuid4()
    store = _store(
        redis_url,
        key_secret="session-fence-integration-secret-key-01",
        lock_ttl_seconds=1,
    )
    _delete_store_keys(redis_client, store, (user_id,), (session_id,))
    try:
        with ThreadPoolExecutor(max_workers=8) as executor:
            tokens = list(
                executor.map(
                    lambda _: store.acquire_session(user_id, session_id),
                    range(8),
                )
            )
        acquired = [token for token in tokens if token is not None]
        assert len(acquired) == 1
        old_token = acquired[0]

        time.sleep(1.1)
        new_token = store.acquire_session(user_id, session_id)
        assert new_token is not None
        assert new_token != old_token

        with pytest.raises(ChatSessionFenceLost):
            store.append_turn(
                user_id,
                session_id,
                old_token,
                ChatTurn("stale question", "stale answer"),
            )
        store.release_session(user_id, session_id, old_token)
        assert store.acquire_session(user_id, session_id) is None

        assert (
            store.append_turn(
                user_id,
                session_id,
                new_token,
                ChatTurn("current question", "current answer"),
            )
            == 1
        )
        assert store.load_history(user_id, session_id) == (
            ChatTurn("current question", "current answer"),
        )
        store.release_session(user_id, session_id, new_token)
        assert store.acquire_session(user_id, session_id) is not None
    finally:
        _delete_store_keys(redis_client, store, (user_id,), (session_id,))
