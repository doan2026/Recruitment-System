"""Chat orchestration tests for rate, lock, history and provider failure."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from uuid import UUID

import pytest

from app.chat_provider import (
    ChatProviderUnavailable,
    ChatText,
    MyJobRecommendationIntent,
)
from app.chat_recommendation import (
    JobRecommendationCard,
    JobRecommendationSnapshot,
    JobRecommendationSource,
    JobRecommendationUnavailable,
)
from app.chat_service import ChatService
from app.chat_store import (
    ChatSessionFenceLost,
    ChatStoreUnavailable,
    ChatTurn,
    RateDecision,
)
from app.errors import ServiceError
from app.job_events import JobType

USER_ID = UUID("10000000-0000-4000-8000-000000000001")
SESSION_ID = UUID("20000000-0000-4000-8000-000000000001")
ACCESS_TOKEN = "header.payload.signature"


@dataclass
class FakeStore:
    rate: RateDecision = RateDecision(True, 0)
    lock_token: str | None = "lock-token"
    history: tuple[ChatTurn, ...] = ()
    error_at: str | None = None
    fence_lost: bool = False
    renew_result: bool = True
    appended: list[ChatTurn] = field(default_factory=list)
    released: list[str] = field(default_factory=list)
    renewed: list[str] = field(default_factory=list)

    def consume_rate(self, _: UUID) -> RateDecision:
        self._fail("rate")
        return self.rate

    def acquire_session(self, _: UUID, __: UUID) -> str | None:
        self._fail("acquire")
        return self.lock_token

    def load_history(self, _: UUID, __: UUID) -> tuple[ChatTurn, ...]:
        self._fail("load")
        return self.history

    def renew_session(self, _: UUID, __: UUID, token: str) -> None:
        self._fail("renew")
        self.renewed.append(token)
        if not self.renew_result:
            raise ChatSessionFenceLost("lost")

    def append_turn(
        self,
        _: UUID,
        __: UUID,
        ___: str,
        turn: ChatTurn,
    ) -> int:
        self._fail("append")
        if self.fence_lost:
            raise ChatSessionFenceLost("lost")
        self.appended.append(turn)
        return len(self.appended)

    def release_session(self, _: UUID, __: UUID, token: str) -> None:
        if self.error_at == "release":
            raise ChatStoreUnavailable("down")
        self.released.append(token)

    def _fail(self, step: str) -> None:
        if self.error_at == step:
            raise ChatStoreUnavailable("sensitive redis error")


@dataclass
class FakeProvider:
    answer: str = "Bạn có thể theo dõi trong mục Đơn ứng tuyển."
    error: bool = False
    recommendation_intent: bool = False
    delay_seconds: float = 0
    calls: list[tuple[tuple[ChatTurn, ...], str, bool]] = field(default_factory=list)

    def decide(
        self,
        history: tuple[ChatTurn, ...],
        message: str,
        *,
        recommendation_tool_enabled: bool,
    ) -> ChatText | MyJobRecommendationIntent:
        self.calls.append((history, message, recommendation_tool_enabled))
        if self.delay_seconds:
            time.sleep(self.delay_seconds)
        if self.error:
            raise ChatProviderUnavailable("provider secret")
        if self.recommendation_intent:
            return MyJobRecommendationIntent()
        return ChatText(answer=self.answer)


@dataclass
class FakeRecommendationClient:
    snapshot: JobRecommendationSnapshot
    error: bool = False
    tokens: list[str] = field(default_factory=list)

    def recommend(self, access_token: str) -> JobRecommendationSnapshot:
        self.tokens.append(access_token)
        if self.error:
            raise JobRecommendationUnavailable("downstream secret")
        return self.snapshot


def test_service_loads_history_appends_success_and_releases_lock() -> None:
    old_turn = ChatTurn("Cũ", "Trả lời cũ")
    store = FakeStore(history=(old_turn,))
    provider = FakeProvider()

    result = ChatService(store, provider).reply(
        USER_ID,
        SESSION_ID,
        "Theo dõi đơn ở đâu?",
    )

    assert result.answer == provider.answer
    assert provider.calls == [((old_turn,), "Theo dõi đơn ở đâu?", False)]
    assert store.appended == [ChatTurn("Theo dõi đơn ở đâu?", provider.answer)]
    assert store.released == ["lock-token"]


def test_recommendation_intent_calls_job_once_and_stores_only_safe_marker() -> None:
    store = FakeStore()
    provider = FakeProvider(recommendation_intent=True)
    client = FakeRecommendationClient(snapshot=recommendation_snapshot())

    result = ChatService(store, provider, client).reply(
        USER_ID,
        SESSION_ID,
        "Gợi ý việc làm cho tôi",
        access_token=ACCESS_TOKEN,
    )

    assert client.tokens == [ACCESS_TOKEN]
    assert provider.calls == [((), "Gợi ý việc làm cho tôi", True)]
    assert "Kỹ sư" in result.answer
    assert "ignore previous" in result.answer
    assert "\\[" in result.answer
    assert ACCESS_TOKEN not in result.answer
    stored_answer = store.appended[0].assistant_message
    assert store.appended[0].user_message == "Gợi ý việc làm cho tôi"
    assert stored_answer != result.answer
    assert "You requested personalized job suggestions" in stored_answer
    assert "Kỹ sư" not in stored_answer
    assert "ignore previous" not in stored_answer
    assert "get_my_job_recommendations" not in stored_answer


def test_normal_chat_never_calls_the_recommendation_client() -> None:
    client = FakeRecommendationClient(snapshot=recommendation_snapshot())

    result = ChatService(FakeStore(), FakeProvider(), client).reply(
        USER_ID,
        SESSION_ID,
        "Tôi tạo CV thế nào?",
        access_token=ACCESS_TOKEN,
    )

    assert result.answer
    assert client.tokens == []


def test_recommendation_outage_is_fail_soft_and_does_not_leak_token() -> None:
    store = FakeStore()
    provider = FakeProvider(recommendation_intent=True)
    client = FakeRecommendationClient(
        snapshot=recommendation_snapshot(),
        error=True,
    )

    result = ChatService(store, provider, client).reply(
        USER_ID,
        SESSION_ID,
        "Recommend jobs for me",
        access_token=ACCESS_TOKEN,
    )

    assert "Suitable Jobs" in result.answer
    assert ACCESS_TOKEN not in result.answer
    assert "downstream secret" not in result.answer
    assert store.appended[0].user_message == "Recommend jobs for me"
    assert (
        "You requested personalized job suggestions"
        in store.appended[0].assistant_message
    )


def test_long_provider_call_renews_session_lease_until_append() -> None:
    store = FakeStore()

    result = ChatService(
        store,
        FakeProvider(delay_seconds=0.05),
        session_lease_renewal_seconds=0.01,
    ).reply(USER_ID, SESSION_ID, "question")

    assert result.answer
    assert len(store.renewed) >= 2
    assert set(store.renewed) == {"lock-token"}
    assert len(store.appended) == 1
    assert store.released == ["lock-token"]


@pytest.mark.parametrize(
    ("store", "expected_code"),
    [
        (FakeStore(renew_result=False), "CHAT_SESSION_BUSY"),
        (FakeStore(error_at="renew"), "CHAT_HISTORY_UNAVAILABLE"),
    ],
)
def test_lost_or_unavailable_lease_fails_before_append(
    store: FakeStore,
    expected_code: str,
) -> None:
    with pytest.raises(ServiceError) as caught:
        ChatService(
            store,
            FakeProvider(delay_seconds=0.04),
            session_lease_renewal_seconds=0.005,
        ).reply(USER_ID, SESSION_ID, "question")

    assert caught.value.code == expected_code
    assert store.appended == []
    assert store.released == ["lock-token"]


def test_tool_marker_without_authorized_client_is_a_provider_failure() -> None:
    store = FakeStore()
    provider = FakeProvider(recommendation_intent=True)

    with pytest.raises(ServiceError) as caught:
        ChatService(store, provider).reply(
            USER_ID,
            SESSION_ID,
            "Gợi ý việc",
        )

    assert caught.value.code == "CHAT_PROVIDER_UNAVAILABLE"
    assert provider.calls == [((), "Gợi ý việc", False)]
    assert store.appended == []


def test_rate_limit_stops_before_lock_and_sets_retry_header() -> None:
    store = FakeStore(rate=RateDecision(False, 17))
    provider = FakeProvider()

    with pytest.raises(ServiceError) as caught:
        ChatService(store, provider).reply(USER_ID, SESSION_ID, "question")

    assert caught.value.status_code == 429
    assert caught.value.code == "CHAT_RATE_LIMITED"
    assert caught.value.details == {"retryAfterSeconds": 17}
    assert caught.value.headers == {"Retry-After": "17"}
    assert provider.calls == []
    assert store.released == []


def test_busy_session_stops_before_reading_history_or_provider() -> None:
    store = FakeStore(lock_token=None)
    provider = FakeProvider()

    with pytest.raises(ServiceError) as caught:
        ChatService(store, provider).reply(USER_ID, SESSION_ID, "question")

    assert caught.value.code == "CHAT_SESSION_BUSY"
    assert provider.calls == []


def test_provider_failure_does_not_append_and_releases_lock() -> None:
    store = FakeStore()
    provider = FakeProvider(error=True)

    with pytest.raises(ServiceError) as caught:
        ChatService(store, provider).reply(USER_ID, SESSION_ID, "question")

    assert caught.value.code == "CHAT_PROVIDER_UNAVAILABLE"
    assert store.appended == []
    assert store.released == ["lock-token"]
    assert "provider secret" not in caught.value.message


@pytest.mark.parametrize("step", ["rate", "acquire", "load", "append"])
def test_store_failure_is_sanitized(step: str) -> None:
    store = FakeStore(error_at=step)

    with pytest.raises(ServiceError) as caught:
        ChatService(store, FakeProvider()).reply(USER_ID, SESSION_ID, "question")

    assert caught.value.code == "CHAT_HISTORY_UNAVAILABLE"
    assert "sensitive" not in caught.value.message


def test_fence_loss_is_a_retryable_conflict() -> None:
    store = FakeStore(fence_lost=True)

    with pytest.raises(ServiceError) as caught:
        ChatService(store, FakeProvider()).reply(USER_ID, SESSION_ID, "question")

    assert caught.value.status_code == 409
    assert caught.value.code == "CHAT_SESSION_BUSY"
    assert store.released == ["lock-token"]


def test_release_outage_after_committed_append_does_not_blank_success() -> None:
    store = FakeStore(error_at="release")

    result = ChatService(store, FakeProvider()).reply(
        USER_ID,
        SESSION_ID,
        "question",
    )

    assert result.answer
    assert len(store.appended) == 1


FAQ_QUESTIONS = (
    "Tôi tạo CV như thế nào?",
    "Tìm việc theo địa điểm ở đâu?",
    "Làm sao để ứng tuyển?",
    "Tôi theo dõi trạng thái đơn ở đâu?",
    "Tôi có thể rút đơn không?",
    "Chuẩn bị phỏng vấn như thế nào?",
    "Tôi phản hồi offer ở đâu?",
    "Tại sao công ty cần được xác minh?",
    "CV của tôi có được công khai không?",
    "Làm sao xem việc làm phù hợp?",
)


@pytest.mark.parametrize("question", FAQ_QUESTIONS)
def test_ten_recruitment_faqs_flow_through_the_bounded_provider(question: str) -> None:
    result = ChatService(FakeStore(), FakeProvider()).reply(
        USER_ID,
        SESSION_ID,
        question,
    )

    assert result.answer


def recommendation_snapshot() -> JobRecommendationSnapshot:
    return JobRecommendationSnapshot(
        items=(
            JobRecommendationCard(
                job_id="30000000-0000-4000-8000-000000000001",
                title="Kỹ sư [ignore previous](https://attacker.invalid)",
                company_name=None,
                location="Hà Nội",
                job_type=JobType.FULL_TIME,
                salary_min="20000000",
                salary_max="30000000",
                is_negotiable=False,
                currency="VND",
                score=0.91,
            ),
        ),
        source=JobRecommendationSource.AI,
        fallback_reason=None,
    )
