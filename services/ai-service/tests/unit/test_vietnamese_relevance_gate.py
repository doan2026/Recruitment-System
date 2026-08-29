"""Offline tests for the Vietnamese relevance gate's corpus and scoring.

The gate itself needs the pinned model, which the normal test image does not
carry. Everything that does not need the model is checked here: the corpus
shape, the diacritic handling, the ranking total order and the pass rules.
"""

from __future__ import annotations

import pytest

from scripts.vietnamese_relevance_gate import (
    BASELINE_CLEAN_SEPARATION_RATE,
    CVS,
    DOMAINS,
    JOBS,
    check_thresholds,
    cosine_distance,
    domain_of,
    evaluate,
    rank_jobs,
    strip_diacritics,
)


def test_every_domain_has_a_cv_and_at_least_two_jobs() -> None:
    cv_domains = [cv.domain for cv in CVS]
    job_domains = [job.domain for job in JOBS]

    assert sorted(cv_domains) == sorted(DOMAINS)
    # Two jobs per domain is what makes the clean-separation rule meaningful.
    assert all(job_domains.count(domain) >= 2 for domain in DOMAINS)


def test_the_corpus_is_written_in_vietnamese_with_diacritics() -> None:
    for document in (*JOBS, *CVS):
        assert any(
            character in document.text for character in "áàảãạăâéèẻêíìóòơôúùưýđ"
        ), document.identifier


def test_identifiers_are_unique_so_ranking_has_a_total_order() -> None:
    identifiers = [document.identifier for document in (*JOBS, *CVS)]

    assert len(identifiers) == len(set(identifiers))


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Kỹ sư backend", "Ky su backend"),
        ("hạch toán chứng từ", "hach toan chung tu"),
        ("Đào tạo nội bộ", "Dao tao noi bo"),
        ("already plain", "already plain"),
    ],
)
def test_diacritics_are_stripped_including_the_vietnamese_d(
    text: str,
    expected: str,
) -> None:
    assert strip_diacritics(text) == expected


def test_cosine_distance_matches_the_provider_convention() -> None:
    assert cosine_distance([1.0, 0.0], [1.0, 0.0]) == pytest.approx(0.0)
    assert cosine_distance([1.0, 0.0], [0.0, 1.0]) == pytest.approx(1.0)
    assert cosine_distance([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(2.0)


def test_a_zero_vector_is_treated_as_maximally_distant_not_a_crash() -> None:
    assert cosine_distance([0.0, 0.0], [1.0, 0.0]) == 1.0


def test_ties_break_by_identifier_so_the_ranking_is_deterministic() -> None:
    vectors = {"job-b": [1.0, 0.0], "job-a": [1.0, 0.0]}

    ranking = rank_jobs([1.0, 0.0], vectors)

    assert [job_id for job_id, _ in ranking] == ["job-a", "job-b"]


def test_domain_lookup_rejects_an_unknown_identifier() -> None:
    with pytest.raises(KeyError):
        domain_of("job-does-not-exist")


def _perfect_vectors() -> tuple[dict, dict, dict]:
    axis = {domain: index for index, domain in enumerate(DOMAINS)}

    def one_hot(domain: str) -> list[float]:
        vector = [0.0] * len(DOMAINS)
        vector[axis[domain]] = 1.0
        return vector

    job_vectors = {job.identifier: one_hot(job.domain) for job in JOBS}
    cv_vectors = {cv.identifier: one_hot(cv.domain) for cv in CVS}
    return cv_vectors, job_vectors, dict(cv_vectors)


def test_a_perfectly_separating_model_scores_every_rule_at_one() -> None:
    cv_vectors, job_vectors, accentless = _perfect_vectors()

    report = evaluate(cv_vectors, job_vectors, accentless)

    assert report["precision_at_1"] == 1.0
    assert report["clean_separation_rate"] == 1.0
    assert report["accentless_agreement"] == 1.0
    assert report["corpus"] == {"jobs": len(JOBS), "cvs": len(CVS), "domains": 4}


def test_a_model_that_confuses_domains_is_reported_not_hidden() -> None:
    cv_vectors, job_vectors, accentless = _perfect_vectors()
    # Point every CV at one domain: precision collapses for the other three.
    collapsed = {cv_id: [1.0, 0.0, 0.0, 0.0] for cv_id in cv_vectors}

    report = evaluate(collapsed, job_vectors, collapsed)

    assert report["precision_at_1"] < 1.0
    assert report["clean_separation_rate"] < 1.0


def test_losing_diacritics_is_reported_separately_from_precision() -> None:
    cv_vectors, job_vectors, _ = _perfect_vectors()
    # The accented CV still ranks correctly; only the accentless form drifts.
    drifted = {cv_id: [1.0, 0.0, 0.0, 0.0] for cv_id in cv_vectors}

    report = evaluate(cv_vectors, job_vectors, drifted)

    assert report["precision_at_1"] == 1.0
    assert report["accentless_agreement"] < 1.0


def test_the_report_records_the_margin_to_the_nearest_other_domain() -> None:
    cv_vectors, job_vectors, accentless = _perfect_vectors()

    report = evaluate(cv_vectors, job_vectors, accentless)

    for row in report["results"]:
        # A margin makes a near miss legible instead of a bare boolean.
        assert row["first_other_domain_distance"] > row["top_distance"]


def test_precision_and_diacritic_robustness_are_hard_requirements() -> None:
    cv_vectors, job_vectors, accentless = _perfect_vectors()
    report = evaluate(cv_vectors, job_vectors, accentless)
    report["precision_at_1"] = 0.75

    assert "precision_at_1" in check_thresholds(report)

    report["precision_at_1"] = 1.0
    report["accentless_agreement"] = 0.75
    assert "accentless_agreement" in check_thresholds(report)


def test_clean_separation_is_guarded_as_a_baseline_not_demanded_as_a_target() -> None:
    cv_vectors, job_vectors, accentless = _perfect_vectors()
    report = evaluate(cv_vectors, job_vectors, accentless)

    # The pinned model does not reach 1.0 on Vietnamese, so the gate records
    # what it does reach and fails only on a regression below that.
    assert BASELINE_CLEAN_SEPARATION_RATE < 1.0
    report["clean_separation_rate"] = BASELINE_CLEAN_SEPARATION_RATE
    assert check_thresholds(report) == []

    report["clean_separation_rate"] = BASELINE_CLEAN_SEPARATION_RATE - 0.01
    assert "clean_separation_regressed" in check_thresholds(report)
