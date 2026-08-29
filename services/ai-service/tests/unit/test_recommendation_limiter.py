"""Unit tests for the distributed recommendation limit safety boundary."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest

from app.recommendation_limiter import (
    RecommendationLimiterUnavailable,
    RecommendationSurface,
    RedisRecommendationLimiter,
)

SUBJECT_ID = UUID("10000000-0000-4000-8000-000000000001")
OTHER_SUBJECT_ID = UUID("10000000-0000-4000-8000-000000000002")
KEY_SECRET = "recommend-limiter-test-key-secret-32-bytes"
OTHER_KEY_SECRET = "recommend-limiter-other-key-secret-32-byte"


class FakeRedis:
    def __init__(self) -> None:
        self.eval_results: list[Any] = []
        self.calls: list[tuple[Any, ...]] = []
        self.failure: Exception | None = None
        self.closed = False

    def eval(self, script: str, number_of_keys: int, *values: Any) -> Any:
        self.calls.append(("eval", script, number_of_keys, *values))
        if self.failure is not None:
            raise self.failure
        if not self.eval_results:
            raise AssertionError("missing fake eval result")
        return self.eval_results.pop(0)

    def close(self) -> None:
        self.closed = True


def _limiter(
    redis_client: FakeRedis,
    *,
    key_secret: str = KEY_SECRET,
    window_seconds: int = 60,
    subject_limit: int = 30,
    global_limit: int = 600,
) -> RedisRecommendationLimiter:
    return RedisRecommendationLimiter(
        redis_client,  # type: ignore[arg-type]
        key_secret=key_secret,
        window_seconds=window_seconds,
        subject_limit=subject_limit,
        global_limit=global_limit,
    )


def test_allowed_decision_carries_no_retry_delay() -> None:
    redis_client = FakeRedis()
    redis_client.eval_results.append([1, 0])

    decision = _limiter(redis_client).consume(
        RecommendationSurface.JOBS,
        SUBJECT_ID,
    )

    assert decision.allowed is True
    assert decision.retry_after_seconds == 0


def test_rejected_decision_carries_the_scripted_retry_delay() -> None:
    redis_client = FakeRedis()
    redis_client.eval_results.append([0, 17])

    decision = _limiter(redis_client).consume(
        RecommendationSurface.CANDIDATES,
        SUBJECT_ID,
    )

    assert decision.allowed is False
    assert decision.retry_after_seconds == 17


def test_limits_and_window_are_passed_to_the_single_script() -> None:
    redis_client = FakeRedis()
    redis_client.eval_results.append([1, 0])

    _limiter(
        redis_client,
        window_seconds=45,
        subject_limit=7,
        global_limit=90,
    ).consume(RecommendationSurface.JOBS, SUBJECT_ID)

    call = redis_client.calls[0]
    assert call[0] == "eval"
    assert call[2] == 2
    # window milliseconds, subject limit, global limit, then a unique member.
    assert call[5:8] == (45_000, 7, 90)
    assert isinstance(call[8], str) and len(call[8]) == 32


def test_redis_failure_fails_closed_instead_of_serving() -> None:
    redis_client = FakeRedis()
    redis_client.failure = RuntimeError("redis is down")

    with pytest.raises(RecommendationLimiterUnavailable):
        _limiter(redis_client).consume(RecommendationSurface.JOBS, SUBJECT_ID)


@pytest.mark.parametrize(
    "result",
    [
        [1, 5],
        [0, 0],
        [2, 0],
        [0, 61],
        [1],
        [1, 0, 0],
        "allowed",
        [True, 0],
        [1, None],
    ],
)
def test_unexpected_script_result_fails_closed(result: Any) -> None:
    redis_client = FakeRedis()
    redis_client.eval_results.append(result)

    with pytest.raises(RecommendationLimiterUnavailable):
        _limiter(redis_client, window_seconds=60).consume(
            RecommendationSurface.JOBS,
            SUBJECT_ID,
        )


def test_keys_never_contain_the_raw_subject_identifier() -> None:
    redis_client = FakeRedis()
    redis_client.eval_results.append([1, 0])

    _limiter(redis_client).consume(RecommendationSurface.JOBS, SUBJECT_ID)

    subject_key, global_key = redis_client.calls[0][3:5]
    assert str(SUBJECT_ID) not in subject_key
    assert str(SUBJECT_ID) not in global_key
    assert SUBJECT_ID.hex not in subject_key


def test_each_subject_gets_its_own_budget() -> None:
    redis_client = FakeRedis()
    redis_client.eval_results.extend([[1, 0], [1, 0]])
    limiter = _limiter(redis_client)

    limiter.consume(RecommendationSurface.JOBS, SUBJECT_ID)
    limiter.consume(RecommendationSurface.JOBS, OTHER_SUBJECT_ID)

    first_subject, first_global = redis_client.calls[0][3:5]
    second_subject, second_global = redis_client.calls[1][3:5]
    assert first_subject != second_subject
    # One surface shares a single global budget across its subjects.
    assert first_global == second_global


def test_each_surface_keeps_a_separate_budget_and_slot() -> None:
    redis_client = FakeRedis()
    redis_client.eval_results.extend([[1, 0], [1, 0]])
    limiter = _limiter(redis_client)

    limiter.consume(RecommendationSurface.JOBS, SUBJECT_ID)
    limiter.consume(RecommendationSurface.CANDIDATES, SUBJECT_ID)

    jobs_subject, jobs_global = redis_client.calls[0][3:5]
    candidates_subject, candidates_global = redis_client.calls[1][3:5]
    assert jobs_subject != candidates_subject
    assert jobs_global != candidates_global
    assert ":jobs:" in jobs_subject
    assert ":candidates:" in candidates_subject


def test_both_keys_of_one_surface_share_one_cluster_slot() -> None:
    redis_client = FakeRedis()
    redis_client.eval_results.append([1, 0])

    _limiter(redis_client).consume(RecommendationSurface.JOBS, SUBJECT_ID)

    subject_key, global_key = redis_client.calls[0][3:5]
    subject_tag = subject_key.split("{", 1)[1].split("}", 1)[0]
    global_tag = global_key.split("{", 1)[1].split("}", 1)[0]
    assert subject_tag == global_tag


def test_a_different_secret_derives_a_different_key_space() -> None:
    first_client = FakeRedis()
    first_client.eval_results.append([1, 0])
    second_client = FakeRedis()
    second_client.eval_results.append([1, 0])

    _limiter(first_client).consume(RecommendationSurface.JOBS, SUBJECT_ID)
    _limiter(second_client, key_secret=OTHER_KEY_SECRET).consume(
        RecommendationSurface.JOBS,
        SUBJECT_ID,
    )

    assert first_client.calls[0][3:5] != second_client.calls[0][3:5]


@pytest.mark.parametrize(
    "key_secret",
    ["", "too-short", "x" * 513, "contains space in the secret value here"],
)
def test_invalid_key_secret_is_rejected(key_secret: str) -> None:
    with pytest.raises(ValueError):
        _limiter(FakeRedis(), key_secret=key_secret)


@pytest.mark.parametrize(
    ("window_seconds", "subject_limit", "global_limit"),
    [
        (0, 30, 600),
        (3_601, 30, 600),
        (60, 0, 600),
        (60, 30, 29),
        (60, True, 600),
    ],
)
def test_invalid_bounds_are_rejected(
    window_seconds: Any,
    subject_limit: Any,
    global_limit: Any,
) -> None:
    with pytest.raises(ValueError):
        _limiter(
            FakeRedis(),
            window_seconds=window_seconds,
            subject_limit=subject_limit,
            global_limit=global_limit,
        )


def test_non_uuid_subject_is_rejected_before_touching_redis() -> None:
    redis_client = FakeRedis()

    with pytest.raises(ValueError):
        _limiter(redis_client).consume(
            RecommendationSurface.JOBS,
            "10000000-0000-4000-8000-000000000001",  # type: ignore[arg-type]
        )

    assert redis_client.calls == []


def test_close_never_raises_when_redis_is_unreachable() -> None:
    redis_client = FakeRedis()

    _limiter(redis_client).close()

    assert redis_client.closed is True


@pytest.mark.parametrize(
    "redis_url",
    [
        "http://redis:6379",
        "redis://:secret@/0",
        "redis://:secret@redis:6379/0#fragment",
        "redis://:secret@redis:6379/0?db=1",
    ],
)
def test_invalid_redis_url_is_rejected(redis_url: str) -> None:
    with pytest.raises(ValueError):
        RedisRecommendationLimiter.from_url(redis_url, key_secret=KEY_SECRET)
