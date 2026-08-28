"""Anthropic adapter tests use no network or provider credential."""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

import app.chat_provider as chat_provider_module
from app.chat_prompt import SYSTEM_PROMPT, SYSTEM_PROMPT_WITH_RECOMMENDATIONS
from app.chat_provider import (
    MY_JOB_RECOMMENDATION_TOOL,
    MY_JOB_RECOMMENDATION_TOOL_CHOICE,
    AnthropicChatProvider,
    ChatProviderUnavailable,
    ChatText,
    MyJobRecommendationIntent,
    _TotalDeadlineTransport,
)
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

    decision = provider.decide(
        (ChatTurn("Câu hỏi trước", "Trả lời trước"),),
        "Câu hỏi hiện tại",
        recommendation_tool_enabled=False,
    )

    assert decision == ChatText(answer="Hướng dẫn an toàn.")
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
        provider.decide((), "question", recommendation_tool_enabled=False)


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
            truncated.decide(
                (),
                "question",
                recommendation_tool_enabled=False,
            )

    provider = make_provider(FakeMessages(error=RuntimeError("secret response body")))

    with pytest.raises(ChatProviderUnavailable, match="invalid response") as caught:
        provider.decide((), "question", recommendation_tool_enabled=False)

    assert "secret response body" not in str(caught.value)


def test_provider_exposes_only_the_parameter_free_recommendation_tool() -> None:
    messages = FakeMessages(
        response=SimpleNamespace(
            content=[
                SimpleNamespace(
                    type="tool_use",
                    id="toolu_safe-id_01",
                    name="get_my_job_recommendations",
                    input={},
                )
            ],
            stop_reason="tool_use",
        )
    )

    decision = make_provider(messages).decide(
        (),
        "Gợi ý việc làm cho tôi",
        recommendation_tool_enabled=True,
    )

    assert decision == MyJobRecommendationIntent()
    assert messages.request == {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 512,
        "system": SYSTEM_PROMPT_WITH_RECOMMENDATIONS,
        "messages": [{"role": "user", "content": "Gợi ý việc làm cho tôi"}],
        "tools": [MY_JOB_RECOMMENDATION_TOOL],
        "tool_choice": MY_JOB_RECOMMENDATION_TOOL_CHOICE,
    }
    assert MY_JOB_RECOMMENDATION_TOOL["input_schema"] == {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": False,
    }


@pytest.mark.parametrize(
    "content",
    [
        [
            SimpleNamespace(
                type="tool_use",
                id="toolu_1",
                name="unknown_tool",
                input={},
            )
        ],
        [
            SimpleNamespace(
                type="tool_use",
                id="toolu_1",
                name="get_my_job_recommendations",
                input={"cv_id": "attacker-selected"},
            )
        ],
        [
            SimpleNamespace(
                type="tool_use",
                id="toolu_1",
                name="get_my_job_recommendations",
                input={"url": "https://attacker.invalid"},
            )
        ],
        [
            SimpleNamespace(
                type="text",
                text="I will call the tool.",
            ),
            SimpleNamespace(
                type="tool_use",
                id="toolu_1",
                name="get_my_job_recommendations",
                input={},
            ),
        ],
        [
            SimpleNamespace(
                type="tool_use",
                id="toolu_1",
                name="get_my_job_recommendations",
                input={},
            ),
            SimpleNamespace(
                type="tool_use",
                id="toolu_2",
                name="get_my_job_recommendations",
                input={},
            ),
        ],
        [
            SimpleNamespace(
                type="tool_use",
                id="unsafe id",
                name="get_my_job_recommendations",
                input={},
            )
        ],
    ],
)
def test_provider_rejects_unknown_parameterized_mixed_and_multiple_tools(
    content: list[object],
) -> None:
    provider = make_provider(
        FakeMessages(response=SimpleNamespace(content=content, stop_reason="tool_use"))
    )

    with pytest.raises(ChatProviderUnavailable, match="invalid response"):
        provider.decide(
            (),
            "malicious tool request",
            recommendation_tool_enabled=True,
        )


def test_offline_sdk_client_constructs_and_closes_without_provider_call() -> None:
    provider = AnthropicChatProvider(
        api_key="offline-anthropic-key-00000000000001",
        model="claude-haiku-4-5-20251001",
        timeout_seconds=15,
        max_output_tokens=512,
    )

    provider.close()


def test_provider_transport_enforces_total_deadline_across_response_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ticks = iter((100.0, 100.1, 100.5, 101.0))
    monkeypatch.setattr(chat_provider_module, "monotonic", lambda: next(ticks))

    class TwoChunkStream(httpx.SyncByteStream):
        def __iter__(self):
            yield b'{"content":'
            yield b'"slow"}'

    class FakeTransport(httpx.BaseTransport):
        closed = False

        def handle_request(self, request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, stream=TwoChunkStream(), request=request)

        def close(self) -> None:
            self.closed = True

    inner = FakeTransport()
    with httpx.Client(
        transport=_TotalDeadlineTransport(1.0, transport=inner)
    ) as client:
        with pytest.raises(httpx.ReadTimeout):
            with client.stream(
                "GET",
                "https://api.anthropic.com/v1/messages",
            ) as response:
                tuple(response.iter_raw())

    assert inner.closed is True
