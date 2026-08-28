"""Bounded PDF text extraction in a disposable child process."""

from __future__ import annotations

import hashlib
import io
import json
import multiprocessing
import re
import unicodedata
from dataclasses import dataclass, field
from multiprocessing.connection import Connection
from typing import NoReturn

_IPC_OVERHEAD_BYTES = 512
_REJECTION_CODES = frozenset(
    {
        "CV_PDF_ENCRYPTED",
        "CV_PDF_INVALID",
        "CV_PDF_PAGE_LIMIT",
        "CV_PDF_RESOURCE_LIMIT",
        "CV_PDF_TEXT_EMPTY",
        "CV_PDF_TEXT_LIMIT",
    }
)


class CvPdfRejected(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class CvPdfParserUnavailable(RuntimeError):
    pass


class _PdfResourceLimit(BaseException):
    pass


@dataclass(frozen=True, slots=True)
class CvEmbeddingDocument:
    text: str = field(repr=False)
    text_hash: str


class IsolatedPdfTextExtractor:
    def __init__(
        self,
        *,
        timeout_seconds: float = 15.0,
        maximum_pages: int = 100,
        maximum_text_characters: int = 500_000,
    ) -> None:
        if timeout_seconds <= 0 or maximum_pages <= 0 or maximum_text_characters <= 0:
            raise ValueError("PDF extraction limits must be positive")
        self._timeout_seconds = timeout_seconds
        self._maximum_pages = maximum_pages
        self._maximum_text_characters = maximum_text_characters

    def extract(self, payload: bytes) -> CvEmbeddingDocument:
        if not payload.startswith(b"%PDF-"):
            raise CvPdfRejected("CV_PDF_INVALID")
        context = multiprocessing.get_context("spawn")
        receiver, sender = context.Pipe(duplex=False)
        process = context.Process(
            target=_extract_child,
            args=(
                sender,
                payload,
                self._maximum_pages,
                self._maximum_text_characters,
            ),
            daemon=True,
        )
        response_ready = False
        try:
            process.start()
            sender.close()
            response_ready = receiver.poll(self._timeout_seconds)
            if not response_ready:
                _stop_process(process)
                raise CvPdfRejected("CV_PDF_TIMEOUT")
            response = receiver.recv_bytes(
                maxlength=(self._maximum_text_characters * 4) + _IPC_OVERHEAD_BYTES
            )
            process.join(timeout=1)
        except CvPdfRejected:
            raise
        except EOFError as error:
            process.join(timeout=1)
            exit_rejection = _child_exit_rejection_code(process.exitcode)
            if exit_rejection is not None:
                raise CvPdfRejected(exit_rejection) from None
            _stop_process(process)
            raise CvPdfParserUnavailable from error
        except OSError as error:
            _stop_process(process)
            receive_rejection = _receive_error_rejection_code(response_ready)
            if receive_rejection is not None:
                raise CvPdfRejected(receive_rejection) from None
            raise CvPdfParserUnavailable from error
        except RuntimeError as error:
            _stop_process(process)
            raise CvPdfParserUnavailable from error
        finally:
            receiver.close()
            sender.close()
            if process.is_alive():
                _stop_process(process)
        status, value = _decode_child_response(
            response,
            maximum_text_characters=self._maximum_text_characters,
        )
        if status == "ok":
            return CvEmbeddingDocument(
                text=value,
                text_hash=hashlib.sha256(value.encode("utf-8")).hexdigest(),
            )
        if status == "unavailable":
            raise CvPdfParserUnavailable
        raise CvPdfRejected(value)


def _extract_child(
    sender: Connection,
    payload: bytes,
    maximum_pages: int,
    maximum_text_characters: int,
) -> None:
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            _send_child_response(
                sender,
                {"code": "CV_PARSER_UNAVAILABLE", "status": "unavailable"},
            )
            return
        _apply_resource_limits()
        try:
            reader = PdfReader(io.BytesIO(payload), strict=True)
            if reader.is_encrypted:
                _send_rejection(sender, "CV_PDF_ENCRYPTED")
                return
            if len(reader.pages) == 0 or len(reader.pages) > maximum_pages:
                _send_rejection(sender, "CV_PDF_PAGE_LIMIT")
                return
            sections: list[str] = []
            character_count = 0
            for page in reader.pages:
                text = page.extract_text() or ""
                character_count += len(text)
                if character_count > maximum_text_characters:
                    _send_rejection(sender, "CV_PDF_TEXT_LIMIT")
                    return
                sections.append(text)
            normalized = _normalize_text("\n".join(sections))
            if not normalized:
                _send_rejection(sender, "CV_PDF_TEXT_EMPTY")
                return
            if len(normalized) > maximum_text_characters:
                _send_rejection(sender, "CV_PDF_TEXT_LIMIT")
                return
        except _PdfResourceLimit:
            _send_rejection(sender, "CV_PDF_RESOURCE_LIMIT")
            return
        except Exception:
            _send_rejection(sender, "CV_PDF_INVALID")
            return
        _send_child_response(sender, {"status": "ok", "text": normalized})
    finally:
        sender.close()


def _send_rejection(sender: Connection, code: str) -> None:
    _send_child_response(sender, {"code": code, "status": "rejected"})


def _send_child_response(sender: Connection, response: dict[str, str]) -> None:
    sender.send_bytes(
        json.dumps(
            response,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )


def _decode_child_response(
    response: bytes,
    *,
    maximum_text_characters: int,
) -> tuple[str, str]:
    try:
        decoded = response.decode("utf-8")
        parsed = json.loads(
            decoded,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_json_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, _DuplicateJsonKey):
        raise CvPdfParserUnavailable from None
    if not isinstance(parsed, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in parsed.items()
    ):
        raise CvPdfParserUnavailable
    status = parsed.get("status")
    if status == "ok":
        if set(parsed) != {"status", "text"}:
            raise CvPdfParserUnavailable
        text = parsed["text"]
        if (
            not text
            or len(text) > maximum_text_characters
            or text != _normalize_text(text)
        ):
            raise CvPdfParserUnavailable
        return status, text
    if status == "rejected":
        if set(parsed) != {"code", "status"} or parsed.get("code") not in (
            _REJECTION_CODES
        ):
            raise CvPdfParserUnavailable
        return status, parsed["code"]
    if status == "unavailable":
        if parsed != {"code": "CV_PARSER_UNAVAILABLE", "status": "unavailable"}:
            raise CvPdfParserUnavailable
        return status, parsed["code"]
    raise CvPdfParserUnavailable


class _DuplicateJsonKey(ValueError):
    pass


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise _DuplicateJsonKey
        value[key] = item
    return value


def _reject_json_constant(_value: str) -> NoReturn:
    raise _DuplicateJsonKey


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).replace("\x00", " ")
    normalized = "".join(
        character
        for character in normalized
        if character in {"\n", "\t"}
        or not unicodedata.category(character).startswith("C")
    )
    lines = [re.sub(r"\s+", " ", line).strip() for line in normalized.splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _apply_resource_limits() -> None:
    try:
        import resource
        import signal

        memory = 512 * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        if hasattr(signal, "SIGXCPU"):
            signal.signal(signal.SIGXCPU, _raise_resource_limit)
        resource.setrlimit(resource.RLIMIT_CPU, (9, 10))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    except (ImportError, OSError, ValueError):
        # The parent still enforces a hard wall-clock timeout and byte/page/text caps.
        return


def _raise_resource_limit(_signum: int, _frame: object) -> None:
    raise _PdfResourceLimit


def _child_exit_rejection_code(exit_code: int | None) -> str | None:
    return "CV_PDF_RESOURCE_LIMIT" if exit_code is not None and exit_code < 0 else None


def _receive_error_rejection_code(response_ready: bool) -> str | None:
    return "CV_PDF_RESOURCE_LIMIT" if response_ready else None


def _stop_process(process: multiprocessing.Process) -> None:
    if process.is_alive():
        process.terminate()
        process.join(timeout=1)
    if process.is_alive() and hasattr(process, "kill"):
        process.kill()
        process.join(timeout=1)
