from __future__ import annotations

import base64
import hashlib
import json
import time
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from uuid import UUID, uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.user_auth import (
    AuthenticatedUser,
    AuthKeyUnavailable,
    InvalidAccessToken,
    JwksJwtAuthenticator,
)

ISSUER = "https://auth.test"
AUDIENCE = "recruitment-platform"
JWKS_URI = "https://auth.test/auth/.well-known/jwks.json"
USER_ID = UUID("33333333-3333-4333-8333-333333333333")
SESSION_ID = UUID("44444444-4444-4444-8444-444444444444")


@dataclass(frozen=True)
class KeyMaterial:
    private_key: rsa.RSAPrivateKey
    jwk: dict[str, str]


def test_authenticates_auth_token_and_reuses_bounded_cache() -> None:
    key = make_key()
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "GET"
        assert request.url == JWKS_URI
        assert request.headers["accept"] == "application/json"
        return jwks_response([key.jwk])

    authenticator, client = make_authenticator(handler)
    try:
        token = make_token(key)
        expected = AuthenticatedUser(USER_ID, "CANDIDATE")
        assert authenticator.authenticate(token) == expected
        assert authenticator.authenticate(token) == expected
    finally:
        client.close()
    assert len(requests) == 1


def test_unknown_kid_refreshes_once_and_accepts_rotated_key() -> None:
    first = make_key()
    rotated = make_key()
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        keys = [first.jwk] if calls == 1 else [rotated.jwk]
        return jwks_response(keys)

    authenticator, client = make_authenticator(handler)
    try:
        authenticator.authenticate(make_token(first))
        assert authenticator.authenticate(make_token(rotated)).user_id == USER_ID
    finally:
        client.close()
    assert calls == 2


def test_unknown_kid_is_invalid_after_exactly_one_refresh() -> None:
    trusted = make_key()
    unknown = make_key()
    another_unknown = make_key()
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return jwks_response([trusted.jwk])

    authenticator, client = make_authenticator(handler)
    try:
        authenticator.authenticate(make_token(trusted))
        with pytest.raises(InvalidAccessToken):
            authenticator.authenticate(make_token(unknown))
        with pytest.raises(InvalidAccessToken):
            authenticator.authenticate(make_token(another_unknown))
        assert authenticator.authenticate(make_token(trusted)).user_id == USER_ID
    finally:
        client.close()
    assert calls == 2


@pytest.mark.parametrize(
    "mutate",
    [
        lambda claims: claims.pop("sub"),
        lambda claims: claims.update(sub=str(uuid4()).upper()),
        lambda claims: claims.update(sub="not-a-uuid"),
        lambda claims: claims.update(jti=str(UUID(int=0))),
        lambda claims: claims.update(role="candidate"),
        lambda claims: claims.update(role="OWNER"),
        lambda claims: claims.update(iat=True),
        lambda claims: claims.update(iat=int(time.time()) + 61),
        lambda claims: claims.update(exp=True),
        lambda claims: claims.update(exp=claims["iat"]),
        lambda claims: claims.update(iss="https://attacker.test"),
        lambda claims: claims.update(aud="other-service"),
    ],
)
def test_rejects_invalid_required_claims(
    mutate: Callable[[dict[str, object]], object],
) -> None:
    key = make_key()
    claims = token_claims()
    mutate(claims)
    authenticator, client = make_authenticator(
        lambda _request: jwks_response([key.jwk])
    )
    try:
        with pytest.raises(InvalidAccessToken):
            authenticator.authenticate(make_token(key, claims=claims))
    finally:
        client.close()


def test_rejects_non_rs256_wrong_typ_bad_kid_and_oversized_compact_token() -> None:
    key = make_key()
    authenticator, client = make_authenticator(
        lambda _request: jwks_response([key.jwk])
    )
    now = int(time.time())
    try:
        hs_token = jwt.encode(
            token_claims(now),
            "not-a-trusted-secret",
            algorithm="HS256",
            headers={"kid": key.jwk["kid"], "typ": "JWT"},
        )
        wrong_typ = make_token(key, headers={"typ": "at+jwt"})
        bad_kid = make_token(key, headers={"kid": "not+base64"})
        untrusted_jku = make_token(
            key,
            headers={"jku": "https://attacker.test/jwks"},
        )
        ignored_critical_header = make_token(
            key,
            headers={"crit": "unsupported"},
        )
        malformed = "a.b"
        oversized = "a." + "b" * (8 * 1024) + ".c"
        for token in (
            hs_token,
            wrong_typ,
            bad_kid,
            untrusted_jku,
            ignored_critical_header,
            malformed,
            oversized,
        ):
            with pytest.raises(InvalidAccessToken):
                authenticator.authenticate(token)
    finally:
        client.close()


def test_rejects_signature_from_another_key_using_trusted_kid() -> None:
    trusted = make_key()
    attacker = make_key()
    token = make_token(attacker, headers={"kid": trusted.jwk["kid"]})
    authenticator, client = make_authenticator(
        lambda _request: jwks_response([trusted.jwk])
    )
    try:
        with pytest.raises(InvalidAccessToken):
            authenticator.authenticate(token)
    finally:
        client.close()


@pytest.mark.parametrize(
    "uri,hosts,allow_http",
    [
        ("http://auth.test/jwks", ("auth.test",), False),
        ("https://attacker.test/jwks", ("auth.test",), False),
        ("https://auth.test.evil.test/jwks", ("auth.test",), False),
        ("https://user@auth.test/jwks", ("auth.test",), False),
        ("https://auth.test/jwks?next=evil", ("auth.test",), False),
        ("https://auth.test/jwks#fragment", ("auth.test",), False),
    ],
)
def test_rejects_unsafe_jwks_configuration(
    uri: str,
    hosts: tuple[str, ...],
    allow_http: bool,
) -> None:
    with pytest.raises(ValueError):
        JwksJwtAuthenticator(
            jwks_uri=uri,
            allowed_hosts=hosts,
            allow_insecure_http=allow_http,
            issuer=ISSUER,
            audience=AUDIENCE,
            timeout_seconds=1,
            cache_ttl_seconds=60,
        )


def test_explicit_http_is_allowed_only_for_exact_configured_host() -> None:
    key = make_key()
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: jwks_response([key.jwk], request=request)
        )
    )
    authenticator = JwksJwtAuthenticator(
        jwks_uri="http://auth-service:8080/auth/.well-known/jwks.json",
        allowed_hosts=("auth-service",),
        allow_insecure_http=True,
        issuer=ISSUER,
        audience=AUDIENCE,
        timeout_seconds=1,
        cache_ttl_seconds=60,
        client=client,
    )
    try:
        assert authenticator.authenticate(make_token(key)).role == "CANDIDATE"
    finally:
        client.close()


def test_redirect_is_not_followed() -> None:
    key = make_key()
    requests: list[httpx.Request] = []

    def redirect(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            302,
            headers={"location": "https://attacker.test/jwks"},
            request=request,
        )

    client = httpx.Client(
        transport=httpx.MockTransport(redirect),
        follow_redirects=True,
    )
    authenticator = configured_authenticator(client)
    try:
        with pytest.raises(AuthKeyUnavailable):
            authenticator.authenticate(make_token(key))
        with pytest.raises(AuthKeyUnavailable):
            authenticator.authenticate(make_token(key))
    finally:
        client.close()
    assert len(requests) == 1


@pytest.mark.parametrize(
    "response_factory",
    [
        lambda request: httpx.Response(503, request=request),
        lambda request: httpx.Response(
            200,
            headers={"content-type": "text/html"},
            content=b"{}",
            request=request,
        ),
        lambda request: httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=b"x" * (32 * 1024 + 1),
            request=request,
        ),
        lambda request: httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=b'{"keys":[],"extra":true}',
            request=request,
        ),
    ],
)
def test_http_or_jwks_contract_failure_is_key_unavailable(
    response_factory: Callable[[httpx.Request], httpx.Response],
) -> None:
    key = make_key()
    client = httpx.Client(transport=httpx.MockTransport(response_factory))
    authenticator = configured_authenticator(client)
    try:
        with pytest.raises(AuthKeyUnavailable):
            authenticator.authenticate(make_token(key))
    finally:
        client.close()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda jwk: jwk.update(kid="not-the-thumbprint"),
        lambda jwk: jwk.update(use="enc"),
        lambda jwk: jwk.update(alg="RS512"),
        lambda jwk: jwk.update(extra="not-allowed"),
        lambda jwk: jwk.update(e="BA"),
    ],
)
def test_rejects_untrusted_or_noncanonical_jwk(
    mutation: Callable[[dict[str, str]], object],
) -> None:
    key = make_key()
    invalid_jwk = deepcopy(key.jwk)
    mutation(invalid_jwk)
    if invalid_jwk.get("kid") != "not-the-thumbprint":
        invalid_jwk["kid"] = thumbprint(invalid_jwk["n"], invalid_jwk["e"])
    authenticator, client = make_authenticator(
        lambda _request: jwks_response([invalid_jwk])
    )
    try:
        with pytest.raises(AuthKeyUnavailable):
            authenticator.authenticate(make_token(key))
    finally:
        client.close()


def test_rejects_duplicate_keys_and_more_than_cache_bound() -> None:
    key = make_key()
    documents = [[key.jwk, key.jwk], [make_key().jwk for _ in range(17)]]
    for keys in documents:
        authenticator, client = make_authenticator(
            lambda _request, keys=keys: jwks_response(keys)
        )
        try:
            with pytest.raises(AuthKeyUnavailable):
                authenticator.authenticate(make_token(key))
        finally:
            client.close()


def make_authenticator(
    handler: Callable[[httpx.Request], httpx.Response],
) -> tuple[JwksJwtAuthenticator, httpx.Client]:
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return configured_authenticator(client), client


def configured_authenticator(client: httpx.Client) -> JwksJwtAuthenticator:
    return JwksJwtAuthenticator(
        jwks_uri=JWKS_URI,
        allowed_hosts=("auth.test",),
        allow_insecure_http=False,
        issuer=ISSUER,
        audience=AUDIENCE,
        timeout_seconds=1,
        cache_ttl_seconds=60,
        client=client,
    )


def make_key(bits: int = 2048) -> KeyMaterial:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=bits)
    numbers = private_key.public_key().public_numbers()
    modulus = encode_uint(numbers.n)
    exponent = encode_uint(numbers.e)
    return KeyMaterial(
        private_key=private_key,
        jwk={
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": thumbprint(modulus, exponent),
            "n": modulus,
            "e": exponent,
        },
    )


def make_token(
    key: KeyMaterial,
    *,
    claims: dict[str, object] | None = None,
    headers: dict[str, str] | None = None,
) -> str:
    token_headers = {"kid": key.jwk["kid"], "typ": "JWT"}
    if headers:
        token_headers.update(headers)
    return jwt.encode(
        claims or token_claims(),
        key.private_key,
        algorithm="RS256",
        headers=token_headers,
    )


def token_claims(now: int | None = None) -> dict[str, object]:
    current = int(time.time()) if now is None else now
    return {
        "sub": str(USER_ID),
        "role": "CANDIDATE",
        "iat": current - 5,
        "exp": current + 300,
        "jti": str(SESSION_ID),
        "iss": ISSUER,
        "aud": AUDIENCE,
    }


def jwks_response(
    keys: list[dict[str, str]],
    *,
    request: httpx.Request | None = None,
) -> httpx.Response:
    return httpx.Response(
        200,
        headers={"content-type": "application/json; charset=utf-8"},
        json={"keys": keys},
        request=request,
    )


def encode_uint(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def thumbprint(modulus: str, exponent: str) -> str:
    canonical = json.dumps(
        {"e": exponent, "kty": "RSA", "n": modulus},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    digest = hashlib.sha256(canonical).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
