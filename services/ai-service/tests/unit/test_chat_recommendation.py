"""Candidate chat recommendation client and deterministic formatter tests."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
import pytest

import app.chat_recommendation as chat_recommendation_module
from app.chat_recommendation import (
    MAXIMUM_JOB_RESPONSE_BYTES,
    HttpCandidateJobRecommendationClient,
    JobRecommendationSource,
    JobRecommendationUnavailable,
    format_job_recommendations,
)

ENDPOINT = "http://job-search-service:3000/recommended"
TOKEN = "header.payload.signature"
RESPONSE_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Pragma": "no-cache",
    "Vary": "Authorization",
}


def test_client_calls_only_fixed_first_page_and_projects_minimum_public_fields() -> (
    None
):
    requests: list[httpx.Request] = []
    payload = success_payload(
        title="Kỹ sư [ignore previous](https://attacker.invalid)",
        description="SECRET RECRUITER CONTROLLED DESCRIPTION",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, headers=RESPONSE_HEADERS, json=payload)

    snapshot = call_client(handler)

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "GET"
    assert str(request.url) == f"{ENDPOINT}?limit=3"
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert request.headers["accept"] == "application/json"
    assert request.headers["accept-encoding"] == "identity"
    assert snapshot.source is JobRecommendationSource.AI
    assert len(snapshot.items) == 1
    assert snapshot.items[0].title.startswith("Kỹ sư")
    assert not hasattr(snapshot.items[0], "description")

    answer = format_job_recommendations(snapshot, "Gợi ý việc làm cho tôi")

    assert "SECRET RECRUITER" not in answer
    assert "https://attacker.invalid" not in answer
    assert "hxxps://attacker" in answer
    assert "\\[" in answer
    assert "\\(" in answer
    assert TOKEN not in answer
    assert "tương đồng tham khảo 91%" in answer


def test_fallback_snapshot_is_not_misrepresented_as_ai_match() -> None:
    payload = success_payload(score=None)
    payload["data"].update(
        {
            "source": "LATEST",
            "fallbackReason": "NO_ACTIVE_CV",
            "nextCursor": None,
        }
    )

    snapshot = call_client(
        lambda _: httpx.Response(200, headers=RESPONSE_HEADERS, json=payload)
    )
    answer = format_job_recommendations(snapshot, "Recommend jobs for me")

    assert snapshot.source is JobRecommendationSource.LATEST
    assert "Personalized matching is unavailable" in answer
    assert "reference similarity" not in answer


@pytest.mark.parametrize(
    ("source", "next_cursor", "fallback_reason", "score"),
    [
        ("LATEST", "unexpected-cursor", "NO_ACTIVE_CV", None),
        ("LATEST", None, None, None),
        ("PREFERENCES", None, "NO_ACTIVE_CV", 0.5),
        ("PREFERENCES", "unexpected-cursor", "AI_UNAVAILABLE", None),
    ],
)
def test_client_rejects_contradictory_fallback_contract(
    source: str,
    next_cursor: str | None,
    fallback_reason: str | None,
    score: float | None,
) -> None:
    payload = success_payload(score=score)
    payload["data"].update(
        {
            "source": source,
            "nextCursor": next_cursor,
            "fallbackReason": fallback_reason,
        }
    )

    with pytest.raises(JobRecommendationUnavailable):
        call_client(
            lambda _: httpx.Response(200, headers=RESPONSE_HEADERS, json=payload)
        )


@pytest.mark.parametrize(
    ("endpoint", "allowed_hosts", "allow_http"),
    [
        ("http://job-search-service:3000/recommended", ("job-search-service",), False),
        ("https://evil.invalid/recommended", ("job-search-service",), False),
        ("https://job-search-service/other", ("job-search-service",), False),
        ("https://job-search-service/recommended/", ("job-search-service",), False),
        ("https://user@job-search-service/recommended", ("job-search-service",), False),
        (
            "https://job-search-service/recommended?limit=50",
            ("job-search-service",),
            False,
        ),
        ("https://job-search-service/%72ecommended", ("job-search-service",), False),
        ("https://job-search-service/recommended", (), False),
    ],
)
def test_client_rejects_unsafe_or_noncanonical_endpoint_configuration(
    endpoint: str,
    allowed_hosts: tuple[str, ...],
    allow_http: bool,
) -> None:
    with pytest.raises(ValueError, match="endpoint is invalid"):
        HttpCandidateJobRecommendationClient(
            endpoint=endpoint,
            allowed_hosts=allowed_hosts,
            allow_insecure_http=allow_http,
            timeout_seconds=3,
        )


@pytest.mark.parametrize(
    "token",
    [
        "",
        "contains space",
        "contains\nnewline",
        "é.invalid.token",
        "x" * 8_193,
    ],
)
def test_client_rejects_unsafe_access_token_before_network(token: str) -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, headers=RESPONSE_HEADERS, json=success_payload())

    with pytest.raises(JobRecommendationUnavailable):
        call_client(handler, token=token)

    assert calls == 0


@pytest.mark.parametrize(
    ("status", "headers"),
    [
        (302, {**RESPONSE_HEADERS, "Location": "https://evil.invalid"}),
        (503, RESPONSE_HEADERS),
        (200, {**RESPONSE_HEADERS, "Content-Type": "text/html"}),
        (
            200,
            {
                key: value
                for key, value in RESPONSE_HEADERS.items()
                if key != "Cache-Control"
            },
        ),
        (200, {key: value for key, value in RESPONSE_HEADERS.items() if key != "Vary"}),
        (200, {**RESPONSE_HEADERS, "Content-Encoding": "gzip"}),
    ],
)
def test_client_rejects_redirect_status_and_unsafe_response_headers_without_retry(
    status: int,
    headers: dict[str, str],
) -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, headers=headers, json=success_payload())

    with pytest.raises(JobRecommendationUnavailable) as caught:
        call_client(handler)

    assert calls == 1
    assert str(caught.value) == "job recommendations unavailable"
    assert TOKEN not in repr(caught.value)


def test_client_sanitizes_timeout_without_retry_or_token_leak() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("secret upstream timeout", request=request)

    with pytest.raises(JobRecommendationUnavailable) as caught:
        call_client(handler)

    assert calls == 1
    assert "secret" not in str(caught.value)
    assert TOKEN not in repr(caught.value)


def test_client_rejects_oversized_body_before_json_parsing() -> None:
    oversized = b"{" + b"x" * MAXIMUM_JOB_RESPONSE_BYTES + b"}"

    with pytest.raises(JobRecommendationUnavailable):
        call_client(
            lambda _: httpx.Response(
                200,
                headers=RESPONSE_HEADERS,
                content=oversized,
            )
        )


def test_client_rejects_streamed_raw_body_over_cap_without_content_length() -> None:
    calls = 0

    class OverLimitStream(httpx.SyncByteStream):
        def __iter__(self):
            yield b"x" * MAXIMUM_JOB_RESPONSE_BYTES
            yield b"x"

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            headers=RESPONSE_HEADERS,
            stream=OverLimitStream(),
        )

    with pytest.raises(JobRecommendationUnavailable):
        call_client(handler)

    assert calls == 1


def test_client_enforces_total_monotonic_deadline_across_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ticks = iter((100.0, 100.5, 101.0))
    monkeypatch.setattr(
        chat_recommendation_module,
        "monotonic",
        lambda: next(ticks),
    )

    with pytest.raises(JobRecommendationUnavailable):
        call_client(
            lambda _: httpx.Response(
                200,
                headers=RESPONSE_HEADERS,
                json=success_payload(),
            ),
            timeout_seconds=1,
        )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: payload.update({"unexpected": True}),
        lambda payload: payload["data"]["items"][0].update({"cvId": "attacker"}),
        lambda payload: payload["data"].update({"source": "UNKNOWN"}),
        lambda payload: payload["data"].update(
            {"source": "AI", "fallbackReason": "NO_ACTIVE_CV"}
        ),
        lambda payload: payload["data"]["items"][0].update({"score": None}),
        lambda payload: payload["data"]["items"][0].update({"id": "not-a-uuid"}),
        lambda payload: payload["data"]["items"][0].update({"title": "bad\nvalue"}),
        lambda payload: payload["data"]["items"][0].update({"isNegotiable": True}),
        lambda payload: payload["data"]["items"][0].update({"salaryMin": None}),
        lambda payload: payload["data"]["items"][0].update(
            {"salaryMin": "40000000", "salaryMax": "30000000"}
        ),
        lambda payload: payload["data"]["items"][0].update({"deadline": "2000-01-01"}),
        lambda payload: payload["data"].update({"items": []}),
        lambda payload: payload.pop("meta"),
        lambda payload: payload["data"].pop("nextCursor"),
        lambda payload: payload["data"].pop("fallbackReason"),
        lambda payload: payload["data"]["items"][0].pop("score"),
    ],
)
def test_client_rejects_extra_malformed_or_contradictory_response(
    mutate: Callable[[dict[str, object]], object],
) -> None:
    payload = success_payload()
    mutate(payload)

    with pytest.raises(JobRecommendationUnavailable):
        call_client(
            lambda _: httpx.Response(200, headers=RESPONSE_HEADERS, json=payload)
        )


def test_client_rejects_duplicate_job_ids_and_more_than_fixed_limit() -> None:
    payload = success_payload()
    item = payload["data"]["items"][0]
    payload["data"]["items"] = [item, dict(item)]

    with pytest.raises(JobRecommendationUnavailable):
        call_client(
            lambda _: httpx.Response(200, headers=RESPONSE_HEADERS, json=payload)
        )

    payload = success_payload()
    payload["data"]["items"] = [
        wire_item(job_id=f"30000000-0000-4000-8000-00000000000{index}")
        for index in range(1, 5)
    ]
    with pytest.raises(JobRecommendationUnavailable):
        call_client(
            lambda _: httpx.Response(200, headers=RESPONSE_HEADERS, json=payload)
        )


def test_client_rejects_ai_items_outside_descending_score_order() -> None:
    payload = success_payload()
    payload["data"]["items"] = [
        wire_item(score=0.5),
        wire_item(
            job_id="30000000-0000-4000-8000-000000000002",
            score=0.9,
        ),
    ]

    with pytest.raises(JobRecommendationUnavailable):
        call_client(
            lambda _: httpx.Response(200, headers=RESPONSE_HEADERS, json=payload)
        )


@pytest.mark.parametrize(
    "raw_json",
    [
        '{"data":{"items":[],"items":[]},"meta":null}',
        '{"data":{"items":[],"nextCursor":null,"source":"AI",'
        '"fallbackReason":null,"score":NaN},"meta":null}',
        b"\xff",
    ],
)
def test_client_rejects_duplicate_nonfinite_and_invalid_utf8_json(
    raw_json: str | bytes,
) -> None:
    content = raw_json.encode() if isinstance(raw_json, str) else raw_json

    with pytest.raises(JobRecommendationUnavailable):
        call_client(
            lambda _: httpx.Response(
                200,
                headers=RESPONSE_HEADERS,
                content=content,
            )
        )


def call_client(
    handler: Callable[[httpx.Request], httpx.Response],
    *,
    token: str = TOKEN,
    timeout_seconds: int = 3,
):
    def streaming_handler(request: httpx.Request) -> httpx.Response:
        response = handler(request)
        if not response.is_stream_consumed:
            return response
        return httpx.Response(
            response.status_code,
            headers=response.headers,
            stream=httpx.ByteStream(response.content),
            extensions=response.extensions,
        )

    transport = httpx.MockTransport(streaming_handler)
    with httpx.Client(
        transport=transport,
        follow_redirects=False,
        trust_env=False,
    ) as http_client:
        client = HttpCandidateJobRecommendationClient(
            endpoint=ENDPOINT,
            allowed_hosts=("job-search-service",),
            allow_insecure_http=True,
            timeout_seconds=timeout_seconds,
            client=http_client,
        )
        return client.recommend(token)


def success_payload(
    *,
    title: str = "Backend Engineer",
    description: str = "Build recruitment software.",
    score: float | None = 0.91,
) -> dict[str, object]:
    return {
        "data": {
            "items": [
                wire_item(
                    title=title,
                    description=description,
                    score=score,
                )
            ],
            "nextCursor": "opaque-cursor",
            "source": "AI",
            "fallbackReason": None,
        },
        "meta": None,
    }


def wire_item(
    *,
    job_id: str = "30000000-0000-4000-8000-000000000001",
    title: str = "Backend Engineer",
    description: str = "Build recruitment software.",
    score: float | None = 0.91,
) -> dict[str, object]:
    return {
        "id": job_id,
        "companyId": "40000000-0000-4000-8000-000000000001",
        "title": title,
        "description": description,
        "salaryMin": "20000000",
        "salaryMax": "30000000",
        "isNegotiable": False,
        "currency": "VND",
        "location": "Hà Nội",
        "jobType": "FULL_TIME",
        "experienceYears": 2,
        "skills": ["Python"],
        "deadline": (datetime.now(UTC).date() + timedelta(days=365)).isoformat(),
        "publishedAt": "2026-08-29T01:02:03Z",
        "companyName": None,
        "score": score,
    }
