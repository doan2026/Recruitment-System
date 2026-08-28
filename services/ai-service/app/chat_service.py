"""Candidate chatbot orchestration with durable rate and session fencing."""

from __future__ import annotations

from dataclasses import dataclass
from threading import Event, Thread
from uuid import UUID

from app.chat_provider import (
    ChatProvider,
    ChatProviderUnavailable,
    ChatText,
    MyJobRecommendationIntent,
)
from app.chat_recommendation import (
    CandidateJobRecommendationClient,
    JobRecommendationUnavailable,
    format_job_recommendation_unavailable,
    format_job_recommendations,
)
from app.chat_store import (
    ChatSessionFenceLost,
    ChatStore,
    ChatStoreUnavailable,
    ChatTurn,
)
from app.errors import ServiceError


@dataclass(frozen=True, slots=True)
class ChatResult:
    answer: str


_RECOMMENDATION_HISTORY_MARKER = (
    "You requested personalized job suggestions. "
    "Use the Suitable Jobs screen for current results and details."
)


class ChatService:
    def __init__(
        self,
        store: ChatStore,
        provider: ChatProvider,
        recommendation_client: CandidateJobRecommendationClient | None = None,
        *,
        session_lease_renewal_seconds: float | None = None,
    ) -> None:
        if session_lease_renewal_seconds is not None and (
            isinstance(session_lease_renewal_seconds, bool)
            or session_lease_renewal_seconds <= 0
        ):
            raise ValueError("session lease renewal interval is invalid")
        self._store = store
        self._provider = provider
        self._recommendation_client = recommendation_client
        self._session_lease_renewal_seconds = session_lease_renewal_seconds

    def reply(
        self,
        user_id: UUID,
        session_id: UUID,
        message: str,
        *,
        access_token: str | None = None,
    ) -> ChatResult:
        try:
            rate = self._store.consume_rate(user_id)
        except ChatStoreUnavailable as error:
            raise self._history_unavailable() from error
        if not rate.allowed:
            retry_after = max(1, rate.retry_after_seconds)
            raise ServiceError(
                status_code=429,
                code="CHAT_RATE_LIMITED",
                message="Too many chat requests; retry later",
                details={"retryAfterSeconds": retry_after},
                headers={"Retry-After": str(retry_after)},
            )

        try:
            lock_token = self._store.acquire_session(user_id, session_id)
        except ChatStoreUnavailable as error:
            raise self._history_unavailable() from error
        if lock_token is None:
            raise ServiceError(
                status_code=409,
                code="CHAT_SESSION_BUSY",
                message="This chat session is processing another request",
            )

        lease = _SessionLease(
            self._store,
            user_id,
            session_id,
            lock_token,
            self._session_lease_renewal_seconds,
        )
        try:
            lease.start()
            history = self._store.load_history(user_id, session_id)
            tool_enabled = (
                self._recommendation_client is not None and access_token is not None
            )
            decision = self._provider.decide(
                history,
                message,
                recommendation_tool_enabled=tool_enabled,
            )
            lease.ensure_owned()
            if isinstance(decision, ChatText):
                answer = decision.answer
                history_answer = answer
            elif isinstance(decision, MyJobRecommendationIntent) and tool_enabled:
                try:
                    snapshot = self._recommendation_client.recommend(access_token)
                except JobRecommendationUnavailable:
                    answer = format_job_recommendation_unavailable(message)
                else:
                    answer = format_job_recommendations(snapshot, message)
                history_answer = _RECOMMENDATION_HISTORY_MARKER
            else:
                raise ChatProviderUnavailable("chat provider invalid response")
            lease.ensure_owned()
            self._store.append_turn(
                user_id,
                session_id,
                lock_token,
                ChatTurn(user_message=message, assistant_message=history_answer),
            )
            return ChatResult(answer=answer)
        except ChatProviderUnavailable as error:
            raise ServiceError(
                status_code=503,
                code="CHAT_PROVIDER_UNAVAILABLE",
                message="The recruitment assistant is temporarily unavailable",
            ) from error
        except ChatSessionFenceLost as error:
            raise ServiceError(
                status_code=409,
                code="CHAT_SESSION_BUSY",
                message="This chat session changed; retry the request",
            ) from error
        except ChatStoreUnavailable as error:
            raise self._history_unavailable() from error
        finally:
            lease.stop()
            try:
                self._store.release_session(user_id, session_id, lock_token)
            except ChatStoreUnavailable:
                # The lock has a hard TTL and append is fenced by its exact token.
                pass

    @staticmethod
    def _history_unavailable() -> ServiceError:
        return ServiceError(
            status_code=503,
            code="CHAT_HISTORY_UNAVAILABLE",
            message="Chat history is temporarily unavailable",
        )


class _SessionLease:
    """Keeps a fenced Redis lease alive while blocking providers are in flight."""

    def __init__(
        self,
        store: ChatStore,
        user_id: UUID,
        session_id: UUID,
        lock_token: str,
        renewal_seconds: float | None,
    ) -> None:
        self._store = store
        self._user_id = user_id
        self._session_id = session_id
        self._lock_token = lock_token
        self._renewal_seconds = renewal_seconds
        self._stop = Event()
        self._lost = Event()
        self._failure: ChatStoreUnavailable | ChatSessionFenceLost | None = None
        self._thread: Thread | None = None

    def start(self) -> None:
        if self._renewal_seconds is None:
            return
        self._thread = Thread(
            target=self._renew,
            name="candidate-chat-lease",
            daemon=True,
        )
        try:
            self._thread.start()
        except RuntimeError as error:
            self._thread = None
            raise ChatStoreUnavailable("Chat state is unavailable") from error

    def ensure_owned(self) -> None:
        if not self._lost.is_set():
            return
        if self._failure is not None:
            raise self._failure
        raise ChatSessionFenceLost("Chat session ownership was lost")

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join()

    def _renew(self) -> None:
        assert self._renewal_seconds is not None
        while not self._stop.wait(self._renewal_seconds):
            try:
                self._store.renew_session(
                    self._user_id,
                    self._session_id,
                    self._lock_token,
                )
            except ChatSessionFenceLost:
                self._failure = ChatSessionFenceLost("Chat session ownership was lost")
                self._lost.set()
                return
            except ChatStoreUnavailable:
                self._failure = ChatStoreUnavailable("Chat state is unavailable")
                self._lost.set()
                return
            except Exception:
                self._failure = ChatStoreUnavailable("Chat state is unavailable")
                self._lost.set()
                return
