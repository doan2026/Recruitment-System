"""Unit tests for the lazy sentence-transformers provider."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from app.embedding import (
    DEFAULT_MODEL_REVISION,
    EMBEDDING_DIMENSION,
    EmbeddingProviderError,
    SentenceTransformerEmbeddingProvider,
)


@dataclass
class FakeModel:
    vector: object
    reported_dimension: int = EMBEDDING_DIMENSION
    encode_calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)

    def get_sentence_embedding_dimension(self) -> int:
        return self.reported_dimension

    def encode(self, text: str, **options: object) -> object:
        self.encode_calls.append((text, options))
        if isinstance(self.vector, Exception):
            raise self.vector
        return self.vector


@dataclass
class FakeModelFactory:
    model: FakeModel
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)

    def __call__(self, model_name: str, **options: object) -> FakeModel:
        self.calls.append((model_name, options))
        return self.model


def valid_vector() -> list[float]:
    return [1.0, *([0.0] * (EMBEDDING_DIMENSION - 1))]


def test_provider_loads_model_lazily_on_cpu_and_normalizes_embeddings() -> None:
    model = FakeModel(valid_vector())
    factory = FakeModelFactory(model)
    provider = SentenceTransformerEmbeddingProvider(
        model_name="  example/model  ",
        cache_folder="/models",
        revision="immutable-revision",
        local_files_only=True,
        model_factory=factory,
    )

    assert factory.calls == []
    assert provider.model_name == "example/model@immutable-revision"
    assert provider.dimension == EMBEDDING_DIMENSION

    provider.warm_up()

    assert model.encode_calls == []

    first = provider.embed("job description")
    second = provider.embed("another job")

    assert first == tuple(valid_vector())
    assert second == tuple(valid_vector())
    assert factory.calls == [
        (
            "example/model",
            {
                "device": "cpu",
                "local_files_only": True,
                "trust_remote_code": False,
                "cache_folder": "/models",
                "revision": "immutable-revision",
            },
        )
    ]
    assert model.encode_calls == [
        (
            "job description",
            {
                "convert_to_numpy": True,
                "normalize_embeddings": True,
                "show_progress_bar": False,
            },
        ),
        (
            "another job",
            {
                "convert_to_numpy": True,
                "normalize_embeddings": True,
                "show_progress_bar": False,
            },
        ),
    ]


def test_provider_uses_pinned_default_revision_in_persisted_identity() -> None:
    model = FakeModel(valid_vector())
    factory = FakeModelFactory(model)
    provider = SentenceTransformerEmbeddingProvider(model_factory=factory)

    provider.warm_up()

    assert provider.model_name == (
        f"sentence-transformers/all-MiniLM-L6-v2@{DEFAULT_MODEL_REVISION}"
    )
    assert factory.calls[0][0] == "sentence-transformers/all-MiniLM-L6-v2"
    assert factory.calls[0][1]["revision"] == DEFAULT_MODEL_REVISION
    assert model.encode_calls == []


@pytest.mark.parametrize(
    "vector",
    [
        [1.0] * (EMBEDDING_DIMENSION - 1),
        [0.0] * EMBEDDING_DIMENSION,
        [float("nan"), *([0.0] * (EMBEDDING_DIMENSION - 1))],
        [float("inf"), *([0.0] * (EMBEDDING_DIMENSION - 1))],
        ["not-a-number", *([0.0] * (EMBEDDING_DIMENSION - 1))],
    ],
    ids=["wrong-dimension", "zero", "nan", "infinity", "non-numeric"],
)
def test_provider_rejects_vectors_that_cannot_be_stored(vector: Any) -> None:
    provider = SentenceTransformerEmbeddingProvider(
        model_factory=FakeModelFactory(FakeModel(vector))
    )

    with pytest.raises(EmbeddingProviderError):
        provider.embed("job description")


def test_provider_rejects_model_with_wrong_reported_dimension() -> None:
    provider = SentenceTransformerEmbeddingProvider(
        model_factory=FakeModelFactory(
            FakeModel(valid_vector(), reported_dimension=768)
        )
    )

    with pytest.raises(EmbeddingProviderError, match="incompatible dimension"):
        provider.embed("job description")


def test_provider_does_not_expose_source_text_when_encoding_fails() -> None:
    source_text = "private candidate information"
    provider = SentenceTransformerEmbeddingProvider(
        model_factory=FakeModelFactory(FakeModel(RuntimeError(source_text)))
    )

    with pytest.raises(EmbeddingProviderError) as caught:
        provider.embed(source_text)

    assert source_text not in str(caught.value)


@pytest.mark.parametrize(
    ("arguments", "message"),
    [
        ({"model_name": "  "}, "model_name must not be blank"),
        ({"cache_folder": "  "}, "cache_folder must not be blank"),
        ({"revision": "  "}, "revision must not be blank"),
    ],
)
def test_provider_rejects_blank_configuration(
    arguments: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        SentenceTransformerEmbeddingProvider(**arguments)  # type: ignore[arg-type]


@pytest.mark.parametrize("text", ["", "   "])
def test_provider_rejects_blank_text_without_loading_model(text: str) -> None:
    factory = FakeModelFactory(FakeModel(valid_vector()))
    provider = SentenceTransformerEmbeddingProvider(model_factory=factory)

    with pytest.raises(ValueError, match="text must not be blank"):
        provider.embed(text)

    assert factory.calls == []
