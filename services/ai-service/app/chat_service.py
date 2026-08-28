"""Candidate chatbot orchestration with durable rate and session fencing."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.chat_provider import ChatProvider, ChatProviderUnavailable
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


class ChatService:
    def __init__(self, store: ChatStore, provider: ChatProvider) -> None:
        self._store = store
        self._provider = provider

    def reply(
        self,
        user_id: UUID,
        session_id: UUID,
        message: str,
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

        try:
            history = self._store.load_history(user_id, session_id)
            answer = self._provider.generate(history, message)
            self._store.append_turn(
                user_id,
                session_id,
                lock_token,
                ChatTurn(user_message=message, assistant_message=answer),
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
