"""Bounded Anthropic Messages API adapter for the public chat endpoint."""

from __future__ import annotations

import unicodedata
from collections.abc import Sequence
from typing import Any, Protocol

from anthropic import (
    Anthropic,
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    DefaultHttpxClient,
)

from app.chat_prompt import SYSTEM_PROMPT, provider_messages
from app.chat_store import ChatTurn

MAXIMUM_ANSWER_CHARACTERS = 8_000
MAXIMUM_ANSWER_BYTES = 32 * 1024


class ChatProviderUnavailable(RuntimeError):
    """The provider did not return a safe complete answer."""


class ChatProvider(Protocol):
    def generate(
        self,
        history: Sequence[ChatTurn],
        current_message: str,
    ) -> str: ...


class AnthropicChatProvider:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout_seconds: int,
        max_output_tokens: int,
        client: Any | None = None,
    ) -> None:
        self._model = model
        self._max_output_tokens = max_output_tokens
        self._owns_client = client is None
        self._client = client or Anthropic(
            api_key=api_key,
            base_url="https://api.anthropic.com",
            timeout=float(timeout_seconds),
            max_retries=0,
            http_client=DefaultHttpxClient(trust_env=False),
        )

    def close(self) -> None:
        if not self._owns_client:
            return
        try:
            self._client.close()
        except Exception:
            # Shutdown cleanup is best effort and must not expose provider details.
            pass

    def generate(
        self,
        history: Sequence[ChatTurn],
        current_message: str,
    ) -> str:
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=self._max_output_tokens,
                system=SYSTEM_PROMPT,
                messages=provider_messages(history, current_message),
            )
        except (APITimeoutError, APIConnectionError, APIStatusError) as error:
            raise ChatProviderUnavailable("chat provider unavailable") from error
        except Exception as error:
            raise ChatProviderUnavailable("chat provider invalid response") from error

        if getattr(response, "stop_reason", None) != "end_turn":
            raise ChatProviderUnavailable("chat provider invalid response")
        content = getattr(response, "content", None)
        if not isinstance(content, list) or not content:
            raise ChatProviderUnavailable("chat provider invalid response")
        text_parts: list[str] = []
        for block in content:
            text = getattr(block, "text", None)
            if getattr(block, "type", None) != "text" or not isinstance(text, str):
                raise ChatProviderUnavailable("chat provider invalid response")
            text_parts.append(text)
        answer = unicodedata.normalize("NFC", "\n".join(text_parts)).strip()
        if (
            not answer
            or len(answer) > MAXIMUM_ANSWER_CHARACTERS
            or len(answer.encode("utf-8")) > MAXIMUM_ANSWER_BYTES
            or any(
                (ord(character) < 32 and character not in {"\n", "\t"})
                or 127 <= ord(character) <= 159
                for character in answer
            )
        ):
            raise ChatProviderUnavailable("chat provider invalid response")
        return answer
