from __future__ import annotations

import io
from dataclasses import asdict

import pytest
from pypdf import PdfWriter

from app.cv_parser import (
    CvEmbeddingDocument,
    CvPdfParserUnavailable,
    CvPdfRejected,
    IsolatedPdfTextExtractor,
    _child_exit_rejection_code,
    _decode_child_response,
    _normalize_text,
    _receive_error_rejection_code,
)


def test_normalizes_unicode_control_characters_and_whitespace() -> None:
    assert _normalize_text(" Ｂａｃｋｅｎｄ\x00  Engineer\n\nPython\tSQL ") == (
        "Backend Engineer\nPython SQL"
    )


def test_document_repr_never_contains_raw_cv_text() -> None:
    document = CvEmbeddingDocument("private candidate CV", "a" * 64)
    assert "private candidate CV" not in repr(document)
    assert asdict(document)["text"] == "private candidate CV"


def test_rejects_non_pdf_before_spawning_parser() -> None:
    with pytest.raises(CvPdfRejected) as caught:
        IsolatedPdfTextExtractor().extract(b"private-not-pdf")
    assert caught.value.code == "CV_PDF_INVALID"


def test_real_blank_pdf_is_parsed_in_child_and_rejected_without_text() -> None:
    payload = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(payload)

    with pytest.raises(CvPdfRejected) as caught:
        IsolatedPdfTextExtractor(timeout_seconds=5).extract(payload.getvalue())
    assert caught.value.code == "CV_PDF_TEXT_EMPTY"


@pytest.mark.parametrize(
    "values",
    [
        {"timeout_seconds": 0},
        {"maximum_pages": 0},
        {"maximum_text_characters": 0},
    ],
)
def test_requires_positive_parser_limits(values: dict[str, int]) -> None:
    with pytest.raises(ValueError):
        IsolatedPdfTextExtractor(**values)


def test_child_protocol_accepts_only_bounded_canonical_json() -> None:
    assert _decode_child_response(
        b'{"status":"ok","text":"Backend Engineer"}',
        maximum_text_characters=100,
    ) == ("ok", "Backend Engineer")
    assert _decode_child_response(
        b'{"code":"CV_PDF_INVALID","status":"rejected"}',
        maximum_text_characters=100,
    ) == ("rejected", "CV_PDF_INVALID")
    assert _decode_child_response(
        b'{"code":"CV_PDF_RESOURCE_LIMIT","status":"rejected"}',
        maximum_text_characters=100,
    ) == ("rejected", "CV_PDF_RESOURCE_LIMIT")


def test_signal_killed_child_is_terminal_but_normal_child_crash_is_retryable() -> None:
    assert _child_exit_rejection_code(-9) == "CV_PDF_RESOURCE_LIMIT"
    assert _child_exit_rejection_code(1) is None
    assert _child_exit_rejection_code(None) is None


def test_oversized_child_response_is_terminal_after_poll_only() -> None:
    assert _receive_error_rejection_code(True) == "CV_PDF_RESOURCE_LIMIT"
    assert _receive_error_rejection_code(False) is None


@pytest.mark.parametrize(
    "response",
    [
        b"not-json",
        b'{"status":"ok","status":"ok","text":"private"}',
        b'{"status":"ok","text":" private "}',
        b'{"status":"ok","text":"too long"}',
        b'{"status":"rejected","code":"ARBITRARY"}',
        b'{"status":"ok","text":"private","extra":"field"}',
    ],
)
def test_child_protocol_rejects_malformed_or_unbounded_messages(
    response: bytes,
) -> None:
    with pytest.raises(CvPdfParserUnavailable):
        _decode_child_response(response, maximum_text_characters=7)
