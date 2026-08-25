"""Embedding provider abstractions used by background event consumers.

The sentence-transformers dependency is imported only when the first embedding is
requested.  This keeps the API and unit-test runtimes independent from the large ML
dependency while still allowing a worker to construct the provider during startup.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any, Protocol

DEFAULT_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
EMBEDDING_DIMENSION = 384


class EmbeddingProvider(Protocol):
    """Generate vectors compatible with the pgvector schema."""

    @property
    def model_name(self) -> str: ...

    @property
    def dimension(self) -> int: ...

    def embed(self, text: str) -> tuple[float, ...]: ...


class EmbeddingProviderError(RuntimeError):
    """Raised when an embedding cannot be generated or safely persisted."""


class SentenceTransformerEmbeddingProvider:
    """Lazy, CPU-only sentence-transformers embedding provider."""

    def __init__(
        self,
        *,
        model_name: str = DEFAULT_MODEL_NAME,
        cache_folder: str | None = None,
        revision: str = DEFAULT_MODEL_REVISION,
        local_files_only: bool = False,
        model_factory: Callable[..., Any] | None = None,
    ) -> None:
        normalized_model_name = model_name.strip()
        if not normalized_model_name:
            raise ValueError("model_name must not be blank")
        if cache_folder is not None and not cache_folder.strip():
            raise ValueError("cache_folder must not be blank")
        normalized_revision = revision.strip()
        if not normalized_revision:
            raise ValueError("revision must not be blank")

        self._source_model_name = normalized_model_name
        self._model_name = f"{normalized_model_name}@{normalized_revision}"
        self._cache_folder = cache_folder
        self._revision = normalized_revision
        self._local_files_only = local_files_only
        self._model_factory = model_factory
        self._model: Any | None = None

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def dimension(self) -> int:
        return EMBEDDING_DIMENSION

    def warm_up(self) -> None:
        """Load the pinned model and validate its output dimension."""

        self._get_model()

    def embed(self, text: str) -> tuple[float, ...]:
        if not isinstance(text, str) or not text.strip():
            raise ValueError("text must not be blank")

        model = self._get_model()
        try:
            raw_vector = model.encode(
                text,
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
        except Exception as error:
            raise EmbeddingProviderError(
                "sentence-transformers failed to generate an embedding"
            ) from error

        return _validate_vector(raw_vector)

    def _get_model(self) -> Any:
        if self._model is not None:
            return self._model

        factory = self._model_factory
        if factory is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as error:
                raise EmbeddingProviderError(
                    "sentence-transformers is required by the embedding worker"
                ) from error
            factory = SentenceTransformer

        model_options: dict[str, object] = {
            "device": "cpu",
            "local_files_only": self._local_files_only,
            "trust_remote_code": False,
        }
        if self._cache_folder is not None:
            model_options["cache_folder"] = self._cache_folder
        model_options["revision"] = self._revision

        try:
            model = factory(self._source_model_name, **model_options)
            reported_dimension = model.get_sentence_embedding_dimension()
        except Exception as error:
            raise EmbeddingProviderError(
                "sentence-transformers model could not be loaded"
            ) from error

        if reported_dimension != EMBEDDING_DIMENSION:
            raise EmbeddingProviderError(
                "sentence-transformers model has an incompatible dimension"
            )

        self._model = model
        return model


def _validate_vector(raw_vector: object) -> tuple[float, ...]:
    if hasattr(raw_vector, "tolist"):
        raw_vector = raw_vector.tolist()  # type: ignore[union-attr]
    if isinstance(raw_vector, str | bytes) or not isinstance(raw_vector, Sequence):
        raise EmbeddingProviderError("embedding result must be a numeric vector")
    if len(raw_vector) != EMBEDDING_DIMENSION:
        raise EmbeddingProviderError("embedding result has an incompatible dimension")

    try:
        vector = tuple(float(value) for value in raw_vector)
    except (TypeError, ValueError, OverflowError) as error:
        raise EmbeddingProviderError("embedding result must be numeric") from error

    if not all(math.isfinite(value) for value in vector):
        raise EmbeddingProviderError("embedding result must contain finite values")
    if not any(value != 0.0 for value in vector):
        raise EmbeddingProviderError("embedding result must not be the zero vector")
    return vector
