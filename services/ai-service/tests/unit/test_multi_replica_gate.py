"""Offline tests for the cross-replica invariant gate's decision logic."""

from __future__ import annotations

import pytest

from scripts.multi_replica_gate import (
    GateFailure,
    check_shared_rate_budget,
    require_ok,
)


class ReplayTransport:
    """Serves scripted (status, body) pairs in call order."""

    def __init__(self, responses: list[tuple[int, dict]]) -> None:
        self.responses = responses
        self.targets: list[str] = []

    def __call__(self, base_url, path, payload, api_key, **_):
        self.targets.append(base_url)
        index = min(len(self.targets) - 1, len(self.responses) - 1)
        return self.responses[index]


def test_require_ok_surfaces_the_provider_error_code() -> None:
    with pytest.raises(GateFailure) as failure:
        require_ok(503, {"code": "AI_SERVICE_UNAVAILABLE"}, "first page")

    assert "AI_SERVICE_UNAVAILABLE" in str(failure.value)


def test_a_budget_that_is_never_enforced_fails_the_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ReplayTransport([(200, {"data": {}})])
    monkeypatch.setattr("scripts.multi_replica_gate.post", transport)

    with pytest.raises(GateFailure) as failure:
        check_shared_rate_budget("http://a", "http://b", "k", "cv", 4)

    assert "never enforced" in str(failure.value)


def test_a_per_replica_budget_is_detected_as_over_granting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Eight successes then rejections is what a per-replica limiter looks like
    # when the shared budget was only four.
    responses = [(200, {"data": {}})] * 8 + [(429, {"code": "RATE"})] * 4
    transport = ReplayTransport(responses)
    monkeypatch.setattr("scripts.multi_replica_gate.post", transport)

    with pytest.raises(GateFailure) as failure:
        check_shared_rate_budget("http://a", "http://b", "k", "cv", 4)

    assert "per replica" in str(failure.value)


def test_a_shared_budget_passes_and_reports_its_accounting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = [(200, {"data": {}})] * 2 + [(429, {"code": "RATE"})] * 10
    transport = ReplayTransport(responses)
    monkeypatch.setattr("scripts.multi_replica_gate.post", transport)

    report = check_shared_rate_budget(
        "http://a", "http://b", "k", "cv", 6, already_spent=4
    )

    assert report == {
        "accepted": 2,
        "limited": 12,
        "budget": 6,
        "already_spent": 4,
        "remaining_at_probe": 2,
    }


def test_the_probe_alternates_replicas_so_a_per_process_limiter_shows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = [(200, {"data": {}})] + [(429, {"code": "RATE"})] * 20
    transport = ReplayTransport(responses)
    monkeypatch.setattr("scripts.multi_replica_gate.post", transport)

    check_shared_rate_budget("http://a", "http://b", "k", "cv", 2)

    assert transport.targets[0] == "http://a"
    assert transport.targets[1] == "http://b"


def test_an_unexpected_status_is_a_failure_not_a_silent_skip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ReplayTransport([(500, {"code": "BOOM"})])
    monkeypatch.setattr("scripts.multi_replica_gate.post", transport)

    with pytest.raises(GateFailure) as failure:
        check_shared_rate_budget("http://a", "http://b", "k", "cv", 4)

    assert "500" in str(failure.value)
