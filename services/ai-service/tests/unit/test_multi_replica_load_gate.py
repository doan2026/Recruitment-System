"""Offline tests for the multi-replica load gate's measurement and rules."""

from __future__ import annotations

import pytest

from scripts.multi_replica_load_gate import Call, check, percentile


def _report(**overrides: object) -> dict:
    report = {
        "success_rate": 1.0,
        "p95_ms": 100.0,
        "throughput_rps": 50.0,
        "per_replica_calls": {"http://a": 500, "http://b": 500},
    }
    report.update(overrides)
    return report


def test_a_clean_run_reports_no_failures() -> None:
    assert check(_report(), max_p95_ms=200.0, min_rps=10.0) == []


def test_any_failed_request_fails_the_gate() -> None:
    failures = check(_report(success_rate=0.999), max_p95_ms=200.0, min_rps=10.0)

    # A load gate that tolerates errors measures the wrong thing.
    assert "requests_failed" in failures


def test_a_latency_budget_overrun_is_reported() -> None:
    failures = check(_report(p95_ms=500.0), max_p95_ms=200.0, min_rps=10.0)

    assert "p95_over_budget" in failures


def test_throughput_below_the_floor_is_reported() -> None:
    failures = check(_report(throughput_rps=2.0), max_p95_ms=200.0, min_rps=10.0)

    assert "throughput_under_floor" in failures


def test_an_unbalanced_run_is_caught_rather_than_averaged_away() -> None:
    failures = check(
        _report(per_replica_calls={"http://a": 900, "http://b": 100}),
        max_p95_ms=200.0,
        min_rps=10.0,
    )

    # If one replica took nearly all the traffic, the numbers say nothing
    # about running two.
    assert "load_was_not_balanced" in failures


def test_an_off_by_one_split_is_accepted() -> None:
    failures = check(
        _report(per_replica_calls={"http://a": 501, "http://b": 500}),
        max_p95_ms=200.0,
        min_rps=10.0,
    )

    assert failures == []


@pytest.mark.parametrize(
    ("fraction", "expected"),
    [(0.0, 1.0), (0.5, 3.0), (1.0, 5.0)],
)
def test_percentiles_index_the_sorted_sample(
    fraction: float,
    expected: float,
) -> None:
    assert percentile([5.0, 1.0, 3.0, 2.0, 4.0], fraction) == expected


def test_an_empty_sample_reports_zero_rather_than_raising() -> None:
    assert percentile([], 0.95) == 0.0


def test_a_call_records_the_replica_it_hit() -> None:
    call = Call(replica="http://a", status=200, latency_ms=12.5)

    assert call.replica == "http://a"
    assert call.status == 200
