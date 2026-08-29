"""Real Redis integration tests for the distributed recommendation limits."""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import UUID, uuid4

import pytest
from redis import Redis

from app.recommendation_limiter import (
    RecommendationLimiterUnavailable,
    RecommendationSurface,
    RedisRecommendationLimiter,
)

pytestmark = pytest.mark.integration

KEY_SECRET = "recommend-limiter-integration-secret-0001"
OTHER_KEY_SECRET = "recommend-limiter-integration-secret-0002"


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


@pytest.fixture(autouse=True)
def clean_recommendation_keys(redis_client: Redis) -> None:
    """Give each test an empty budget namespace to assert against."""
    for key in redis_client.scan_iter(match="ai:recommend:*", count=100):
        redis_client.delete(key)


def _limiter(
    redis_url: str,
    *,
    key_secret: str = KEY_SECRET,
    window_seconds: int = 2,
    subject_limit: int = 2,
    global_limit: int = 1_000,
) -> RedisRecommendationLimiter:
    return RedisRecommendationLimiter.from_url(
        redis_url,
        key_secret=key_secret,
        window_seconds=window_seconds,
        subject_limit=subject_limit,
        global_limit=global_limit,
    )


def test_subject_budget_is_enforced_then_recovers_after_the_window(
    redis_url: str,
) -> None:
    limiter = _limiter(redis_url, window_seconds=2, subject_limit=2)
    subject = uuid4()
    try:
        first = limiter.consume(RecommendationSurface.JOBS, subject)
        second = limiter.consume(RecommendationSurface.JOBS, subject)
        third = limiter.consume(RecommendationSurface.JOBS, subject)

        assert first.allowed is True
        assert second.allowed is True
        assert third.allowed is False
        assert 1 <= third.retry_after_seconds <= 2

        time.sleep(2.2)
        assert limiter.consume(RecommendationSurface.JOBS, subject).allowed is True
    finally:
        limiter.close()


def test_one_subject_cannot_spend_another_subjects_budget(
    redis_url: str,
) -> None:
    limiter = _limiter(redis_url, subject_limit=1)
    noisy = uuid4()
    quiet = uuid4()
    try:
        assert limiter.consume(RecommendationSurface.JOBS, noisy).allowed is True
        assert limiter.consume(RecommendationSurface.JOBS, noisy).allowed is False
        assert limiter.consume(RecommendationSurface.JOBS, quiet).allowed is True
    finally:
        limiter.close()


def test_one_surface_cannot_exhaust_the_other_surface(redis_url: str) -> None:
    limiter = _limiter(redis_url, subject_limit=1)
    subject = uuid4()
    try:
        assert limiter.consume(RecommendationSurface.JOBS, subject).allowed is True
        assert limiter.consume(RecommendationSurface.JOBS, subject).allowed is False
        # The same identifier on the other surface still has a full budget.
        assert (
            limiter.consume(RecommendationSurface.CANDIDATES, subject).allowed is True
        )
    finally:
        limiter.close()


def test_global_budget_caps_the_surface_across_many_subjects(
    redis_url: str,
) -> None:
    limiter = _limiter(redis_url, subject_limit=5, global_limit=5)
    try:
        allowed = sum(
            1
            for _ in range(5)
            if limiter.consume(RecommendationSurface.JOBS, uuid4()).allowed
        )
        overflow = limiter.consume(RecommendationSurface.JOBS, uuid4())

        assert allowed == 5
        assert overflow.allowed is False
        assert 1 <= overflow.retry_after_seconds <= 2
    finally:
        limiter.close()


def test_replicas_share_one_budget_instead_of_one_each(redis_url: str) -> None:
    # Two limiter instances stand in for two service replicas: a per-process
    # limiter would grant each of them the full budget.
    first_replica = _limiter(redis_url, subject_limit=3)
    second_replica = _limiter(redis_url, subject_limit=3)
    subject = uuid4()
    try:
        assert (
            first_replica.consume(RecommendationSurface.JOBS, subject).allowed is True
        )
        assert (
            second_replica.consume(RecommendationSurface.JOBS, subject).allowed is True
        )
        assert (
            first_replica.consume(RecommendationSurface.JOBS, subject).allowed is True
        )
        assert (
            second_replica.consume(RecommendationSurface.JOBS, subject).allowed is False
        )
    finally:
        first_replica.close()
        second_replica.close()


def test_concurrent_replicas_never_overspend_the_budget(redis_url: str) -> None:
    budget = 20
    callers = 8
    attempts_per_caller = 10
    limiters = [
        _limiter(redis_url, window_seconds=60, subject_limit=budget)
        for _ in range(callers)
    ]
    subject = uuid4()
    start = Event()

    def hammer(limiter: RedisRecommendationLimiter) -> int:
        start.wait(timeout=10)
        return sum(
            1
            for _ in range(attempts_per_caller)
            if limiter.consume(RecommendationSurface.JOBS, subject).allowed
        )

    try:
        with ThreadPoolExecutor(max_workers=callers) as pool:
            futures = [pool.submit(hammer, limiter) for limiter in limiters]
            start.set()
            granted = sum(future.result(timeout=30) for future in futures)

        # The script reads, checks and writes atomically, so concurrent
        # replicas cannot both take the last slot.
        assert granted == budget
    finally:
        for limiter in limiters:
            limiter.close()


def test_redis_holds_no_raw_subject_identifier(
    redis_url: str,
    redis_client: Redis,
) -> None:
    limiter = _limiter(redis_url, window_seconds=60)
    subject = uuid4()
    try:
        assert limiter.consume(RecommendationSurface.JOBS, subject).allowed is True

        keys = list(redis_client.scan_iter(match="ai:recommend:*", count=100))
        assert keys
        assert all(str(subject) not in key for key in keys)
        assert all(subject.hex not in key for key in keys)
        for key in keys:
            members = redis_client.zrange(key, 0, -1)
            assert all(str(subject) not in member for member in members)
    finally:
        limiter.close()


def test_counters_expire_so_idle_subjects_leave_no_residue(
    redis_url: str,
    redis_client: Redis,
) -> None:
    limiter = _limiter(redis_url, window_seconds=2)
    subject = uuid4()
    try:
        assert limiter.consume(RecommendationSurface.JOBS, subject).allowed is True

        keys = list(redis_client.scan_iter(match="ai:recommend:*", count=100))
        ttls = [redis_client.ttl(key) for key in keys]
        assert keys
        assert all(0 < ttl <= 3 for ttl in ttls)
    finally:
        limiter.close()


def test_a_different_secret_cannot_read_or_spend_the_same_budget(
    redis_url: str,
) -> None:
    limiter = _limiter(redis_url, subject_limit=1)
    foreign = _limiter(redis_url, key_secret=OTHER_KEY_SECRET, subject_limit=1)
    subject = uuid4()
    try:
        assert limiter.consume(RecommendationSurface.JOBS, subject).allowed is True
        assert limiter.consume(RecommendationSurface.JOBS, subject).allowed is False
        # A different key secret derives an independent key space.
        assert foreign.consume(RecommendationSurface.JOBS, subject).allowed is True
    finally:
        limiter.close()
        foreign.close()


def test_unreachable_redis_fails_closed() -> None:
    unreachable = RedisRecommendationLimiter.from_url(
        "redis://:wrong-password@127.0.0.1:6390/15",
        key_secret=KEY_SECRET,
        window_seconds=2,
        subject_limit=2,
    )
    try:
        with pytest.raises(RecommendationLimiterUnavailable):
            unreachable.consume(RecommendationSurface.JOBS, uuid4())
    finally:
        unreachable.close()


def test_both_keys_of_one_surface_live_in_one_cluster_slot(
    redis_url: str,
    redis_client: Redis,
) -> None:
    limiter = _limiter(redis_url, window_seconds=60)
    subject = UUID("50000000-0000-4000-8000-000000000001")
    try:
        assert limiter.consume(RecommendationSurface.JOBS, subject).allowed is True

        keys = [
            key
            for key in redis_client.scan_iter(match="ai:recommend:*", count=100)
            if ":jobs:" in key
        ]
        tags = {key.split("{", 1)[1].split("}", 1)[0] for key in keys}
        assert len(keys) == 2
        assert len(tags) == 1
    finally:
        limiter.close()
