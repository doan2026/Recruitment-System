"""Unit tests for the SLO metrics surface."""

from __future__ import annotations

import pytest

from app.metrics import (
    KNOWN_ROUTES,
    OTHER_ROUTE,
    MetricsRegistry,
    normalize_route,
    status_class,
)


def test_known_routes_keep_their_own_label() -> None:
    for route in KNOWN_ROUTES:
        assert normalize_route(route) == route


@pytest.mark.parametrize(
    "path",
    ["/wp-admin", "/recommend/jobs/../../etc/passwd", "/", "/chat/123"],
)
def test_unknown_paths_collapse_so_scanning_cannot_grow_the_registry(
    path: str,
) -> None:
    assert normalize_route(path) == OTHER_ROUTE


@pytest.mark.parametrize(
    ("code", "expected"),
    [(200, "2xx"), (201, "2xx"), (401, "4xx"), (429, "4xx"), (503, "5xx")],
)
def test_status_codes_collapse_to_a_class(code: int, expected: str) -> None:
    assert status_class(code) == expected


def test_a_scan_of_random_paths_adds_exactly_one_series() -> None:
    registry = MetricsRegistry()

    for index in range(500):
        registry.observe(f"/scan-{index}", 404, 0.001)

    rendered = registry.render()
    assert rendered.count('route="other"') > 0
    assert "scan-0" not in rendered
    # One route label, one status class: cardinality is bounded by design.
    assert rendered.count("ai_http_requests_total{") == 1


def test_no_identifier_can_reach_a_label() -> None:
    registry = MetricsRegistry()
    secret = "10000000-0000-4000-8000-000000000001"

    registry.observe(f"/recommend/jobs/{secret}", 200, 0.01)

    assert secret not in registry.render()


def test_counters_separate_success_from_failure_on_one_route() -> None:
    registry = MetricsRegistry()

    registry.observe("/recommend/jobs", 200, 0.01)
    registry.observe("/recommend/jobs", 200, 0.02)
    registry.observe("/recommend/jobs", 429, 0.001)
    registry.observe("/recommend/jobs", 503, 0.5)

    rendered = registry.render()
    assert 'route="/recommend/jobs",status="2xx"} 2' in rendered
    assert 'route="/recommend/jobs",status="4xx"} 1' in rendered
    assert 'route="/recommend/jobs",status="5xx"} 1' in rendered


def test_histogram_buckets_are_cumulative_and_end_at_infinity() -> None:
    registry = MetricsRegistry(buckets=(0.1, 1.0))

    registry.observe("/match", 200, 0.05)
    registry.observe("/match", 200, 0.5)
    registry.observe("/match", 200, 5.0)

    rendered = registry.render()
    assert 'le="0.1"} 1' in rendered
    assert 'le="1.0"} 2' in rendered
    assert 'le="+Inf"} 3' in rendered
    assert 'ai_http_request_duration_seconds_count{route="/match"} 3' in rendered


def test_the_duration_sum_reflects_observed_latency() -> None:
    registry = MetricsRegistry()

    registry.observe("/match", 200, 0.25)
    registry.observe("/match", 200, 0.75)

    assert 'ai_http_request_duration_seconds_sum{route="/match"} 1.000000' in (
        registry.render()
    )


def test_a_negative_duration_is_clamped_rather_than_corrupting_the_sum() -> None:
    registry = MetricsRegistry()

    registry.observe("/match", 200, -5.0)

    assert 'ai_http_request_duration_seconds_sum{route="/match"} 0.000000' in (
        registry.render()
    )


def test_an_empty_registry_renders_valid_exposition() -> None:
    rendered = MetricsRegistry().render()

    assert rendered.startswith("# HELP")
    assert rendered.endswith("\n")


@pytest.mark.parametrize("buckets", [(), (0.0,), (-1.0, 1.0)])
def test_invalid_buckets_are_rejected(buckets: tuple[float, ...]) -> None:
    with pytest.raises(ValueError):
        MetricsRegistry(buckets=buckets)


def test_concurrent_observations_do_not_lose_counts() -> None:
    from concurrent.futures import ThreadPoolExecutor

    registry = MetricsRegistry()

    def record() -> None:
        for _ in range(200):
            registry.observe("/match", 200, 0.01)

    with ThreadPoolExecutor(max_workers=8) as pool:
        for future in [pool.submit(record) for _ in range(8)]:
            future.result()

    assert 'route="/match",status="2xx"} 1600' in registry.render()
