"""Anthropic adapter tests use no network or provider credential."""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest

from app.chat_prompt import SYSTEM_PROMPT
from app.chat_provider import AnthropicChatProvider, ChatProviderUnavailable
from app.chat_store import ChatTurn


@dataclass
class FakeMessages:
    response: object | None = None
    error: Exception | None = None
    request: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> object:
        self.request = kwargs
        if self.error is not None:
            raise self.error
        if self.response is None:
            raise AssertionError("fake response is required")
        return self.response


def make_provider(messages: FakeMessages) -> AnthropicChatProvider:
    return AnthropicChatProvider(
        api_key="unused-in-injected-client",
        model="claude-haiku-4-5-20251001",
        timeout_seconds=15,
        max_output_tokens=512,
        client=SimpleNamespace(messages=messages),
    )


def test_provider_uses_fixed_system_prompt_bounded_model_and_history() -> None:
    messages = FakeMessages(
        response=SimpleNamespace(
            content=[SimpleNamespace(type="text", text="  Hướng dẫn an toàn.  ")],
            stop_reason="end_turn",
        )
    )
    provider = make_provider(messages)

    answer = provider.generate(
        (ChatTurn("Câu hỏi trước", "Trả lời trước"),),
        "Câu hỏi hiện tại",
    )

    assert answer == "Hướng dẫn an toàn."
    assert messages.request == {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 512,
        "system": SYSTEM_PROMPT,
        "messages": [
            {"role": "user", "content": "Câu hỏi trước"},
            {"role": "assistant", "content": "Trả lời trước"},
            {"role": "user", "content": "Câu hỏi hiện tại"},
        ],
    }


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(content=[], stop_reason="end_turn"),
        SimpleNamespace(
            content=[SimpleNamespace(type="tool_use", text="ignored")],
            stop_reason="end_turn",
        ),
        SimpleNamespace(
            content=[SimpleNamespace(type="text", text="\x00unsafe")],
            stop_reason="end_turn",
        ),
        SimpleNamespace(
            content=[SimpleNamespace(type="text", text="x" * 8_001)],
            stop_reason="end_turn",
        ),
        SimpleNamespace(content="not-a-list", stop_reason="end_turn"),
    ],
)
def test_provider_rejects_empty_non_text_control_and_oversized_output(
    response: object,
) -> None:
    provider = make_provider(FakeMessages(response=response))

    with pytest.raises(ChatProviderUnavailable):
        provider.generate((), "question")


def test_provider_sanitizes_unexpected_client_failure() -> None:
    for stop_reason in (
        "max_tokens",
        "model_context_window_exceeded",
        "tool_use",
        "pause_turn",
    ):
        truncated = make_provider(
            FakeMessages(
                response=SimpleNamespace(
                    content=[SimpleNamespace(type="text", text="partial")],
                    stop_reason=stop_reason,
                )
            )
        )
        with pytest.raises(ChatProviderUnavailable, match="invalid response"):
            truncated.generate((), "question")

    provider = make_provider(FakeMessages(error=RuntimeError("secret response body")))

    with pytest.raises(ChatProviderUnavailable, match="invalid response") as caught:
        provider.generate((), "question")

    assert "secret response body" not in str(caught.value)


def test_offline_sdk_client_constructs_and_closes_without_provider_call() -> None:
    provider = AnthropicChatProvider(
        api_key="offline-anthropic-key-00000000000001",
        model="claude-haiku-4-5-20251001",
        timeout_seconds=15,
        max_output_tokens=512,
    )

    provider.close()
