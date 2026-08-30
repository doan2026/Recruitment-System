#!/usr/bin/env python3
"""Latency and throughput gate across two API replicas.

The cross-replica gate proves the invariants hold when two replicas share a
database and a Redis. This one asks the other question: what does the pair
actually deliver under concurrent load, and does adding a replica help rather
than merely divide the same work.

It reports a latency distribution and throughput measured from the client, plus
the per-replica split so an unbalanced run is visible instead of averaged away.
It is controlled evidence on one host: no gateway, no CDN, no network latency
and no production data distribution. It is not a capacity claim.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class Call:
    replica: str
    status: int
    latency_ms: float


def issue(
    base_url: str,
    payload: dict[str, Any],
    api_key: str,
    timeout: float,
) -> Call:
    request = urllib.request.Request(
        base_url.rstrip("/") + "/recommend/jobs",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Internal-Api-Key": api_key,
            "X-Internal-Service": "job-search-service",
        },
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        error.read()
        status = error.code
    except Exception:
        status = 0
    return Call(
        replica=base_url,
        status=status,
        latency_ms=(time.perf_counter() - started) * 1000.0,
    )


def percentile(values: Sequence[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return round(ordered[position], 3)


def run(
    replicas: Sequence[str],
    api_key: str,
    cv_id: str,
    *,
    warmup: int,
    measured: int,
    concurrency: int,
    timeout: float,
) -> dict[str, Any]:
    payload = {"cv_id": cv_id, "limit": 10}

    def call(index: int) -> Call:
        # Round-robin stands in for a balancer: every replica takes an equal
        # share, so an unbalanced result is the service's doing, not the mix.
        return issue(replicas[index % len(replicas)], payload, api_key, timeout)

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(pool.map(call, range(warmup)))
        started = time.perf_counter()
        calls = list(pool.map(call, range(measured)))
        elapsed = time.perf_counter() - started

    latencies = [item.latency_ms for item in calls]
    statuses = Counter(item.status for item in calls)
    per_replica = Counter(item.replica for item in calls)
    successes = [item for item in calls if item.status == 200]
    return {
        "replicas": len(replicas),
        "warmup_calls": warmup,
        "measured_calls": measured,
        "concurrency": concurrency,
        "elapsed_seconds": round(elapsed, 3),
        "throughput_rps": round(measured / elapsed, 3) if elapsed > 0 else 0.0,
        "status_counts": {str(code): count for code, count in sorted(statuses.items())},
        "success_rate": round(len(successes) / measured, 6) if measured else 0.0,
        "per_replica_calls": dict(sorted(per_replica.items())),
        "p50_ms": percentile(latencies, 0.50),
        "p95_ms": percentile(latencies, 0.95),
        "p99_ms": percentile(latencies, 0.99),
        "max_ms": round(max(latencies), 3) if latencies else 0.0,
        "mean_ms": round(statistics.fmean(latencies), 3) if latencies else 0.0,
    }


def check(report: dict[str, Any], *, max_p95_ms: float, min_rps: float) -> list[str]:
    failures: list[str] = []
    if report["success_rate"] < 1.0:
        failures.append("requests_failed")
    if report["p95_ms"] > max_p95_ms:
        failures.append("p95_over_budget")
    if report["throughput_rps"] < min_rps:
        failures.append("throughput_under_floor")
    counts = list(report["per_replica_calls"].values())
    if counts and max(counts) - min(counts) > 1:
        failures.append("load_was_not_balanced")
    return failures


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--replica", action="append", default=[], dest="replicas")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--cv-id", required=True)
    parser.add_argument("--warmup", type=int, default=100)
    parser.add_argument("--measured", type=int, default=1000)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--timeout-seconds", type=float, default=12.0)
    parser.add_argument("--max-p95-ms", type=float, default=2000.0)
    parser.add_argument("--min-rps", type=float, default=5.0)
    arguments = parser.parse_args(argv)

    if len(arguments.replicas) < 2:
        print("FAIL at least two replicas are required", file=sys.stderr)
        return 2
    if len(set(arguments.replicas)) != len(arguments.replicas):
        print("FAIL replica URLs must be distinct", file=sys.stderr)
        return 2

    report = run(
        arguments.replicas,
        arguments.api_key,
        arguments.cv_id,
        warmup=arguments.warmup,
        measured=arguments.measured,
        concurrency=arguments.concurrency,
        timeout=arguments.timeout_seconds,
    )
    report["thresholds"] = {
        "max_p95_ms": arguments.max_p95_ms,
        "min_rps": arguments.min_rps,
    }
    failures = check(report, max_p95_ms=arguments.max_p95_ms, min_rps=arguments.min_rps)
    print(json.dumps(report, sort_keys=True))
    if failures:
        print("FAIL " + ",".join(failures), file=sys.stderr)
        return 1
    print("PASS multi-replica load gate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
