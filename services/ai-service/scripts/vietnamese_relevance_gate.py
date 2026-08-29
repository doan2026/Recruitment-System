#!/usr/bin/env python3
"""Real-model Vietnamese relevance gate for CV/Job embeddings.

Every embedding test so far uses synthetic vectors, which proves the plumbing
and the arithmetic but says nothing about whether the pinned model actually
separates Vietnamese recruitment text. This gate loads the exact pinned model
revision the worker uses and ranks a curated Vietnamese corpus with it.

The corpus is small and hand-written on purpose: it is a controlled probe of
model behaviour on Vietnamese, not a production relevance benchmark. Passing
here means the model distinguishes Vietnamese job domains and tolerates missing
diacritics; it does not mean production ranking quality has been measured.
"""

from __future__ import annotations

import json
import os
import sys
import unicodedata
from dataclasses import dataclass
from typing import Any

DOMAINS = ("backend", "frontend", "ke_toan", "nhan_su")


@dataclass(frozen=True, slots=True)
class Document:
    identifier: str
    domain: str
    text: str


JOBS: tuple[Document, ...] = (
    Document(
        "job-backend-1",
        "backend",
        "Tuyển kỹ sư backend Java, phát triển API và microservice, "
        "kinh nghiệm Spring Boot, PostgreSQL và Kafka.",
    ),
    Document(
        "job-backend-2",
        "backend",
        "Cần lập trình viên máy chủ, thiết kế cơ sở dữ liệu quan hệ, "
        "tối ưu truy vấn SQL và xây dựng dịch vụ REST.",
    ),
    Document(
        "job-frontend-1",
        "frontend",
        "Tuyển lập trình viên giao diện web, thành thạo React, TypeScript, "
        "HTML và CSS, tối ưu trải nghiệm người dùng trên trình duyệt.",
    ),
    Document(
        "job-frontend-2",
        "frontend",
        "Cần kỹ sư front-end dựng giao diện responsive, làm việc với "
        "component, state management và kiểm thử giao diện.",
    ),
    Document(
        "job-ke-toan-1",
        "ke_toan",
        "Tuyển kế toán tổng hợp, lập báo cáo tài chính, hạch toán chứng từ, "
        "quyết toán thuế và làm việc với cơ quan thuế.",
    ),
    Document(
        "job-ke-toan-2",
        "ke_toan",
        "Cần nhân viên kế toán công nợ, theo dõi hóa đơn, đối chiếu sổ sách "
        "và lập bảng cân đối kế toán hàng tháng.",
    ),
    Document(
        "job-nhan-su-1",
        "nhan_su",
        "Tuyển chuyên viên nhân sự, phụ trách tuyển dụng, phỏng vấn ứng viên, "
        "quản lý hợp đồng lao động và chính sách phúc lợi.",
    ),
    Document(
        "job-nhan-su-2",
        "nhan_su",
        "Cần nhân viên hành chính nhân sự, chấm công, tính lương, bảo hiểm "
        "xã hội và đào tạo nội bộ cho nhân viên.",
    ),
)

CVS: tuple[Document, ...] = (
    Document(
        "cv-backend",
        "backend",
        "Kỹ sư phần mềm bốn năm kinh nghiệm backend, viết API bằng Java và "
        "Spring Boot, làm việc với PostgreSQL, Kafka và kiến trúc microservice.",
    ),
    Document(
        "cv-frontend",
        "frontend",
        "Lập trình viên giao diện ba năm kinh nghiệm, xây dựng ứng dụng web "
        "bằng React và TypeScript, thành thạo HTML, CSS và tối ưu trình duyệt.",
    ),
    Document(
        "cv-ke-toan",
        "ke_toan",
        "Kế toán viên năm năm kinh nghiệm, lập báo cáo tài chính, hạch toán "
        "chứng từ, quyết toán thuế và đối chiếu công nợ.",
    ),
    Document(
        "cv-nhan-su",
        "nhan_su",
        "Chuyên viên nhân sự bốn năm kinh nghiệm, tuyển dụng và phỏng vấn, "
        "quản lý hợp đồng lao động, tính lương và bảo hiểm xã hội.",
    ),
)


def strip_diacritics(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    without_marks = "".join(
        character for character in decomposed if unicodedata.category(character) != "Mn"
    )
    return (
        unicodedata.normalize("NFC", without_marks).replace("đ", "d").replace("Đ", "D")
    )


def cosine_distance(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = sum(value * value for value in left) ** 0.5
    right_norm = sum(value * value for value in right) ** 0.5
    if left_norm == 0.0 or right_norm == 0.0:
        return 1.0
    return 1.0 - (dot / (left_norm * right_norm))


def rank_jobs(
    cv_vector: list[float],
    job_vectors: dict[str, list[float]],
) -> list[tuple[str, float]]:
    scored = [
        (job_id, cosine_distance(cv_vector, vector))
        for job_id, vector in job_vectors.items()
    ]
    # Ties break by identifier so the ranking is a total order, like the
    # production cursor requires.
    scored.sort(key=lambda item: (item[1], item[0]))
    return scored


def domain_of(identifier: str) -> str:
    for document in (*JOBS, *CVS):
        if document.identifier == identifier:
            return document.domain
    raise KeyError(identifier)


def evaluate(
    cv_vectors: dict[str, list[float]],
    job_vectors: dict[str, list[float]],
    accentless_cv_vectors: dict[str, list[float]],
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for cv in CVS:
        ranking = rank_jobs(cv_vectors[cv.identifier], job_vectors)
        ordered_domains = [domain_of(job_id) for job_id, _ in ranking]
        same_domain_positions = [
            position
            for position, domain in enumerate(ordered_domains)
            if domain == cv.domain
        ]
        accentless_ranking = rank_jobs(
            accentless_cv_vectors[cv.identifier], job_vectors
        )
        results.append(
            {
                "cv_id": cv.identifier,
                "domain": cv.domain,
                "top_domain": ordered_domains[0],
                "precision_at_1": ordered_domains[0] == cv.domain,
                # Both same-domain jobs ahead of every other domain is the strong
                # separation claim; positions make a near miss legible.
                "same_domain_positions": same_domain_positions,
                "clean_separation": same_domain_positions == [0, 1],
                "accentless_top_domain": domain_of(accentless_ranking[0][0]),
                "accentless_agrees": (domain_of(accentless_ranking[0][0]) == cv.domain),
                "top_distance": round(ranking[0][1], 6),
                "first_other_domain_distance": round(
                    next(
                        distance
                        for (job_id, distance) in ranking
                        if domain_of(job_id) != cv.domain
                    ),
                    6,
                ),
            }
        )

    return {
        "corpus": {"jobs": len(JOBS), "cvs": len(CVS), "domains": len(DOMAINS)},
        "precision_at_1": sum(1 for row in results if row["precision_at_1"])
        / len(results),
        "clean_separation_rate": sum(1 for row in results if row["clean_separation"])
        / len(results),
        "accentless_agreement": sum(1 for row in results if row["accentless_agrees"])
        / len(results),
        "results": results,
    }


# Measured on the pinned revision against this corpus. The first two are
# properties the model does hold on Vietnamese and must keep holding. The third
# is a recorded baseline, not a target: the pinned model is English-centric and
# reliably ranks only the single closest same-domain Job ahead of every other
# domain. Raising this is a model decision, so the gate guards the measurement
# against regression instead of demanding a number the model never reached.
REQUIRED_PRECISION_AT_1 = 1.0
REQUIRED_ACCENTLESS_AGREEMENT = 1.0
BASELINE_CLEAN_SEPARATION_RATE = 0.25


def check_thresholds(report: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    if report["precision_at_1"] < REQUIRED_PRECISION_AT_1:
        failures.append("precision_at_1")
    if report["accentless_agreement"] < REQUIRED_ACCENTLESS_AGREEMENT:
        failures.append("accentless_agreement")
    if report["clean_separation_rate"] < BASELINE_CLEAN_SEPARATION_RATE:
        failures.append("clean_separation_regressed")
    return failures


def build_encoder() -> Any:
    from app.embedding import SentenceTransformerEmbeddingProvider

    # Pin the cache and refuse network access so the gate measures the exact
    # revision the worker ships, not whatever a download would fetch today.
    provider = SentenceTransformerEmbeddingProvider(
        cache_folder=os.getenv("EMBEDDING_MODEL_CACHE", "/models"),
        local_files_only=True,
    )
    provider.warm_up()
    return provider


def main() -> int:
    encoder = build_encoder()
    job_vectors = {job.identifier: list(encoder.embed(job.text)) for job in JOBS}
    cv_vectors = {cv.identifier: list(encoder.embed(cv.text)) for cv in CVS}
    accentless_cv_vectors = {
        cv.identifier: list(encoder.embed(strip_diacritics(cv.text))) for cv in CVS
    }

    report = evaluate(cv_vectors, job_vectors, accentless_cv_vectors)
    report["model_name"] = encoder.model_name
    print(json.dumps(report, ensure_ascii=True, sort_keys=True))

    failures = check_thresholds(report)
    if failures:
        print("FAIL " + ",".join(failures), file=sys.stderr)
        return 1
    print("PASS Vietnamese relevance gate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
