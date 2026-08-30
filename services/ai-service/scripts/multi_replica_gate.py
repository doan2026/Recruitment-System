#!/usr/bin/env python3
"""Cross-replica invariant gate for the recommendation surfaces.

Running more than one API replica is only safe if the parts of the service that
look stateless really are. Three things have never been checked across
processes, and each one fails quietly rather than loudly:

1. a cursor issued by one replica must be accepted by another, or load
   balancing silently breaks pagination for every Candidate;
2. the same request must return the same page from either replica, or results
   flicker as the balancer moves a session around;
3. the distributed rate limit must be one shared budget, not one budget per
   replica, or the real limit silently multiplies by the replica count.

The gate drives two real replicas over HTTP against one shared PostgreSQL and
one shared Redis. It is controlled evidence for those invariants, not a
capacity or latency benchmark.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

SERVICE_HEADER = "job-search-service"


class GateFailure(RuntimeError):
    pass


def post(
    base_url: str,
    path: str,
    payload: dict[str, Any],
    api_key: str,
    *,
    timeout: float = 15.0,
) -> tuple[int, dict[str, Any]]:
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Internal-Api-Key": api_key,
            "X-Internal-Service": SERVICE_HEADER,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        body = error.read() or b"{}"
        try:
            return error.code, json.loads(body)
        except json.JSONDecodeError:
            return error.code, {}


def require_ok(status: int, body: dict[str, Any], context: str) -> dict[str, Any]:
    if status != 200:
        raise GateFailure(f"{context}: expected 200, got {status} {body.get('code')}")
    return body["data"]


def check_identical_pages(
    replica_a: str,
    replica_b: str,
    api_key: str,
    cv_id: str,
) -> dict[str, Any]:
    payload = {"cv_id": cv_id, "limit": 5}
    status_a, body_a = post(replica_a, "/recommend/jobs", payload, api_key)
    status_b, body_b = post(replica_b, "/recommend/jobs", payload, api_key)
    data_a = require_ok(status_a, body_a, "replica A first page")
    data_b = require_ok(status_b, body_b, "replica B first page")
    if data_a["items"] != data_b["items"]:
        raise GateFailure("replicas returned different items for one request")
    if data_a["next_cursor"] != data_b["next_cursor"]:
        raise GateFailure("replicas issued different cursors for one request")
    return {
        "items": len(data_a["items"]),
        "cursor_present": data_a["next_cursor"] is not None,
    }


def check_cursor_portability(
    replica_a: str,
    replica_b: str,
    api_key: str,
    cv_id: str,
) -> dict[str, Any]:
    status, body = post(
        replica_a, "/recommend/jobs", {"cv_id": cv_id, "limit": 5}, api_key
    )
    first = require_ok(status, body, "replica A page 1")
    cursor = first["next_cursor"]
    if cursor is None:
        raise GateFailure("fixture is too small to produce a continuation")

    status, body = post(
        replica_b,
        "/recommend/jobs",
        {"cv_id": cv_id, "limit": 5, "cursor": cursor},
        api_key,
    )
    if status == 409:
        raise GateFailure(
            "replica B rejected replica A's cursor: pagination is not "
            "portable across replicas"
        )
    second = require_ok(status, body, "replica B page 2 from replica A cursor")

    first_ids = [item["job_id"] for item in first["items"]]
    second_ids = [item["job_id"] for item in second["items"]]
    if set(first_ids) & set(second_ids):
        raise GateFailure("continuation on another replica repeated a job")
    return {"page_one": len(first_ids), "page_two": len(second_ids)}


def check_shared_rate_budget(
    replica_a: str,
    replica_b: str,
    api_key: str,
    cv_id: str,
    budget: int,
    *,
    already_spent: int = 0,
) -> dict[str, Any]:
    payload = {"cv_id": cv_id, "limit": 1}
    accepted = 0
    limited = 0
    # Alternate replicas so a per-process limiter would grant roughly twice the
    # budget before the first rejection.
    for attempt in range(budget * 2 + 2):
        target = replica_a if attempt % 2 == 0 else replica_b
        status, _ = post(target, "/recommend/jobs", payload, api_key)
        if status == 200:
            accepted += 1
        elif status == 429:
            limited += 1
        else:
            raise GateFailure(f"unexpected status {status} during budget probe")
    remaining = max(0, budget - already_spent)
    if limited == 0:
        raise GateFailure("the shared budget was never enforced across replicas")
    if accepted > remaining:
        raise GateFailure(
            f"replicas granted {accepted} calls with only {remaining} left of "
            f"a shared budget of {budget}: the budget is per replica"
        )
    return {
        "accepted": accepted,
        "limited": limited,
        "budget": budget,
        "already_spent": already_spent,
        "remaining_at_probe": remaining,
    }


def main() -> int:
    replica_a = os.getenv("AI_REPLICA_A_URL", "").strip()
    replica_b = os.getenv("AI_REPLICA_B_URL", "").strip()
    api_key = os.getenv("AI_JOB_SEARCH_KEY", "").strip()
    cv_id = os.getenv("AI_GATE_CV_ID", "").strip()
    budget = int(os.getenv("AI_GATE_RATE_BUDGET", "0") or 0)
    if not (replica_a and replica_b and api_key and cv_id):
        print("FAIL missing replica URLs, scoped key or fixture CV", file=sys.stderr)
        return 2
    if replica_a == replica_b:
        print("FAIL both replica URLs are the same process", file=sys.stderr)
        return 2

    report: dict[str, Any] = {"replicas": 2}
    try:
        report["identical_pages"] = check_identical_pages(
            replica_a, replica_b, api_key, cv_id
        )
        report["cursor_portability"] = check_cursor_portability(
            replica_a, replica_b, api_key, cv_id
        )
        if budget > 0:
            # The checks above already spent four calls of this subject's
            # shared budget, so the probe must account for them rather than
            # expect a full budget to remain.
            already_spent = 4
            report["shared_rate_budget"] = check_shared_rate_budget(
                replica_a,
                replica_b,
                api_key,
                cv_id,
                budget,
                already_spent=already_spent,
            )
    except GateFailure as failure:
        print(json.dumps(report, sort_keys=True))
        print(f"FAIL {failure}", file=sys.stderr)
        return 1

    print(json.dumps(report, sort_keys=True))
    print("PASS multi-replica invariants")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
