"""Chat orchestration tests for rate, lock, history and provider failure."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

import pytest

from app.chat_provider import ChatProviderUnavailable
from app.chat_service import ChatService
from app.chat_store import (
    ChatSessionFenceLost,
    ChatStoreUnavailable,
    ChatTurn,
    RateDecision,
)
from app.errors import ServiceError

USER_ID = UUID("10000000-0000-4000-8000-000000000001")
SESSION_ID = UUID("20000000-0000-4000-8000-000000000001")


@dataclass
class FakeStore:
    rate: RateDecision = RateDecision(True, 0)
    lock_token: str | None = "lock-token"
    history: tuple[ChatTurn, ...] = ()
    error_at: str | None = None
    fence_lost: bool = False
    appended: list[ChatTurn] = field(default_factory=list)
    released: list[str] = field(default_factory=list)

    def consume_rate(self, _: UUID) -> RateDecision:
        self._fail("rate")
        return self.rate

    def acquire_session(self, _: UUID, __: UUID) -> str | None:
        self._fail("acquire")
        return self.lock_token

    def load_history(self, _: UUID, __: UUID) -> tuple[ChatTurn, ...]:
        self._fail("load")
        return self.history

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
    calls: list[tuple[tuple[ChatTurn, ...], str]] = field(default_factory=list)

    def generate(self, history: tuple[ChatTurn, ...], message: str) -> str:
        self.calls.append((history, message))
        if self.error:
            raise ChatProviderUnavailable("provider secret")
        return self.answer


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
    assert provider.calls == [((old_turn,), "Theo dõi đơn ở đâu?")]
    assert store.appended == [ChatTurn("Theo dõi đơn ở đâu?", provider.answer)]
    assert store.released == ["lock-token"]


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
