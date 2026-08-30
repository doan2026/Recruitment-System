"""Minimal, dependency-free request metrics for SLO measurement.

Availability and latency SLOs need numbers that outlive a single request, and
this service had none: no counters, no histogram, nothing to point a monitor
at. This module supplies the smallest surface that makes those SLOs
measurable, without adding a dependency to a runtime the project deliberately
keeps light.

Two properties matter more than completeness here:

* **No identifiers in labels.** Labels carry a route name and a status class
  and nothing else. Labelling by ``cv_id``, ``job_id`` or user would turn a
  metrics scrape into a record of who asked for what, which is exactly what the
  rest of the service is built to avoid.
* **Bounded cardinality.** Only known routes are labelled; anything else
  collapses to ``other``. A scanner walking random paths must not be able to
  grow the registry without limit.
"""

from __future__ import annotations

import threading
from collections.abc import Iterable

# Latency buckets in seconds. The tail matters for these surfaces: the
# recommendation scan and the chat provider call are both far slower than a
# health probe, so the buckets run out to the statement/provider timeouts.
LATENCY_BUCKETS: tuple[float, ...] = (
    0.005,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
)

# Every route worth an SLO. Anything else is folded into "other" so path
# scanning cannot inflate cardinality.
KNOWN_ROUTES: frozenset[str] = frozenset(
    {
        "/health",
        "/ready",
        "/metrics",
        "/match",
        "/chat",
        "/recommend/jobs",
        "/recommend/candidates",
    }
)
OTHER_ROUTE = "other"

_STATUS_CLASSES: frozenset[str] = frozenset({"2xx", "4xx", "5xx"})


def normalize_route(path: str) -> str:
    return path if path in KNOWN_ROUTES else OTHER_ROUTE


def status_class(status_code: int) -> str:
    if 200 <= status_code < 300:
        return "2xx"
    if 400 <= status_code < 500:
        return "4xx"
    if 500 <= status_code < 600:
        return "5xx"
    return OTHER_ROUTE


class MetricsRegistry:
    """Thread-safe counters and a latency histogram for HTTP requests."""

    def __init__(self, buckets: Iterable[float] = LATENCY_BUCKETS) -> None:
        ordered = tuple(sorted(float(bucket) for bucket in buckets))
        if not ordered or any(bucket <= 0 for bucket in ordered):
            raise ValueError("buckets must be positive and non-empty")
        self._buckets = ordered
        self._lock = threading.Lock()
        self._requests: dict[tuple[str, str], int] = {}
        self._bucket_counts: dict[str, list[int]] = {}
        self._duration_sum: dict[str, float] = {}
        self._duration_count: dict[str, int] = {}

    def observe(self, route: str, status_code: int, duration_seconds: float) -> None:
        label = normalize_route(route)
        outcome = status_class(status_code)
        duration = max(0.0, float(duration_seconds))
        with self._lock:
            key = (label, outcome)
            self._requests[key] = self._requests.get(key, 0) + 1
            counts = self._bucket_counts.setdefault(label, [0] * len(self._buckets))
            for index, bucket in enumerate(self._buckets):
                if duration <= bucket:
                    counts[index] += 1
            self._duration_sum[label] = self._duration_sum.get(label, 0.0) + duration
            self._duration_count[label] = self._duration_count.get(label, 0) + 1

    def render(self) -> str:
        with self._lock:
            requests = dict(self._requests)
            bucket_counts = {
                label: list(counts) for label, counts in self._bucket_counts.items()
            }
            duration_sum = dict(self._duration_sum)
            duration_count = dict(self._duration_count)

        lines: list[str] = [
            "# HELP ai_http_requests_total Requests by route and status class.",
            "# TYPE ai_http_requests_total counter",
        ]
        for label, outcome in sorted(requests):
            lines.append(
                f'ai_http_requests_total{{route="{label}",status="{outcome}"}} '
                f"{requests[(label, outcome)]}"
            )
        lines.extend(
            [
                "# HELP ai_http_request_duration_seconds Request latency by route.",
                "# TYPE ai_http_request_duration_seconds histogram",
            ]
        )
        for label in sorted(bucket_counts):
            counts = bucket_counts[label]
            for index, bucket in enumerate(self._buckets):
                lines.append(
                    "ai_http_request_duration_seconds_bucket"
                    f'{{route="{label}",le="{bucket}"}} {counts[index]}'
                )
            total = duration_count.get(label, 0)
            lines.append(
                "ai_http_request_duration_seconds_bucket"
                f'{{route="{label}",le="+Inf"}} {total}'
            )
            lines.append(
                "ai_http_request_duration_seconds_sum"
                f'{{route="{label}"}} {duration_sum.get(label, 0.0):.6f}'
            )
            lines.append(
                "ai_http_request_duration_seconds_count" f'{{route="{label}"}} {total}'
            )
        return "\n".join(lines) + "\n"
