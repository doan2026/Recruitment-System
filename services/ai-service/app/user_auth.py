"""Fail-closed Auth access-token verification for user-facing AI APIs."""

from __future__ import annotations

import base64
import binascii
import hashlib
import ipaddress
import json
import math
import re
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit
from uuid import RFC_4122, UUID

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

_MAX_TOKEN_BYTES = 8 * 1024
_MAX_JWKS_BYTES = 32 * 1024
_MAX_JWKS_KEYS = 16
_BASE64URL = re.compile(r"^[A-Za-z0-9_-]+$")
_COMPACT_JWT = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
_ROLES = frozenset({"CANDIDATE", "RECRUITER", "ADMIN"})
_JWK_FIELDS = frozenset({"kty", "use", "alg", "kid", "n", "e"})


class InvalidAccessToken(ValueError):
    """The supplied token is malformed, invalid, or no longer acceptable."""


class AuthKeyUnavailable(RuntimeError):
    """Auth signing keys cannot currently be obtained or trusted."""


class _InvalidJwks(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    user_id: UUID
    role: str


class JwksJwtAuthenticator:
    """Verify Auth-issued JWTs against a bounded, short-lived JWKS cache."""

    def __init__(
        self,
        *,
        jwks_uri: str,
        allowed_hosts: tuple[str, ...],
        allow_insecure_http: bool,
        issuer: str,
        audience: str,
        timeout_seconds: float,
        cache_ttl_seconds: float,
        client: httpx.Client | None = None,
    ) -> None:
        self._allowed_hosts = _validate_allowed_hosts(allowed_hosts)
        self._jwks_uri = _validate_jwks_uri(
            jwks_uri,
            self._allowed_hosts,
            allow_insecure_http,
        )
        self._issuer = _validate_claim_configuration("issuer", issuer)
        self._audience = _validate_claim_configuration("audience", audience)
        self._timeout_seconds = _positive_finite(
            "timeout_seconds",
            timeout_seconds,
        )
        self._cache_ttl_seconds = _positive_finite(
            "cache_ttl_seconds",
            cache_ttl_seconds,
        )
        self._unknown_kid_cooldown_seconds = min(
            30.0,
            self._cache_ttl_seconds,
        )
        self._refresh_failure_cooldown_seconds = min(
            5.0,
            max(1.0, self._timeout_seconds),
        )
        self._client = client or httpx.Client(
            follow_redirects=False,
            timeout=self._timeout_seconds,
            trust_env=False,
        )
        self._owns_client = client is None
        self._keys: dict[str, rsa.RSAPublicKey] = {}
        self._cache_expires_at = 0.0
        self._unknown_kid_refresh_after = 0.0
        self._refresh_after = 0.0
        self._cache_lock = threading.Lock()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def authenticate(self, token: str) -> AuthenticatedUser:
        header = _parse_token_header(token)
        key = self._key_for(header["kid"])
        try:
            claims = jwt.decode(
                token,
                key=key,
                algorithms=["RS256"],
                issuer=self._issuer,
                audience=self._audience,
                options={
                    "require": ["sub", "role", "iat", "exp", "jti"],
                    # Auth permits at most 60 seconds of positive clock skew.  A
                    # global PyJWT leeway would incorrectly extend expiration.
                    "verify_iat": False,
                },
            )
        except jwt.PyJWTError:
            raise InvalidAccessToken from None

        if not isinstance(claims, dict):
            raise InvalidAccessToken
        issued_at = claims.get("iat")
        expires_at = claims.get("exp")
        if type(issued_at) is not int or type(expires_at) is not int:
            raise InvalidAccessToken
        now = int(time.time())
        if issued_at > now + 60 or expires_at <= issued_at or expires_at <= now:
            raise InvalidAccessToken

        user_id = _parse_uuid4(claims.get("sub"))
        _parse_uuid4(claims.get("jti"))
        role = claims.get("role")
        if not isinstance(role, str) or role not in _ROLES:
            raise InvalidAccessToken
        return AuthenticatedUser(user_id=user_id, role=role)

    def _key_for(self, kid: str) -> rsa.RSAPublicKey:
        with self._cache_lock:
            now = time.monotonic()
            cache_is_fresh = now < self._cache_expires_at
            if cache_is_fresh:
                cached = self._keys.get(kid)
                if cached is not None:
                    return cached
                if now < self._unknown_kid_refresh_after:
                    raise InvalidAccessToken

            if now < self._refresh_after:
                if cache_is_fresh:
                    raise InvalidAccessToken
                raise AuthKeyUnavailable

            # A fresh cache may be refreshed once for key rotation.  Globally
            # throttle that path so anonymous random-kid tokens cannot turn
            # every request into blocking JWKS I/O while holding the cache lock.
            if cache_is_fresh:
                self._unknown_kid_refresh_after = (
                    now + self._unknown_kid_cooldown_seconds
                )

            try:
                refreshed = self._fetch_keys()
            except AuthKeyUnavailable:
                self._refresh_after = (
                    time.monotonic() + self._refresh_failure_cooldown_seconds
                )
                raise
            self._refresh_after = 0.0
            self._keys = refreshed
            self._cache_expires_at = time.monotonic() + self._cache_ttl_seconds
            key = refreshed.get(kid)
            if key is None:
                self._unknown_kid_refresh_after = max(
                    self._unknown_kid_refresh_after,
                    time.monotonic() + self._unknown_kid_cooldown_seconds,
                )
                raise InvalidAccessToken
            return key

    def _fetch_keys(self) -> dict[str, rsa.RSAPublicKey]:
        try:
            with self._client.stream(
                "GET",
                self._jwks_uri,
                headers={
                    "Accept": "application/json",
                    "Cache-Control": "no-store",
                },
                follow_redirects=False,
                timeout=self._timeout_seconds,
            ) as response:
                if response.status_code != 200:
                    raise AuthKeyUnavailable
                if not _is_json_content_type(response.headers.get("content-type", "")):
                    raise AuthKeyUnavailable
                declared_length = response.headers.get("content-length")
                if declared_length is not None:
                    if (
                        len(declared_length) > 5
                        or not declared_length.isascii()
                        or not declared_length.isdigit()
                    ):
                        raise AuthKeyUnavailable
                    if int(declared_length) > _MAX_JWKS_BYTES:
                        raise AuthKeyUnavailable
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > _MAX_JWKS_BYTES:
                        raise AuthKeyUnavailable
        except AuthKeyUnavailable:
            raise
        except httpx.HTTPError:
            raise AuthKeyUnavailable from None

        try:
            document = json.loads(
                bytes(body).decode("utf-8", errors="strict"),
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=_reject_json_constant,
            )
            return _parse_jwks(document)
        except (UnicodeDecodeError, json.JSONDecodeError, _InvalidJwks):
            raise AuthKeyUnavailable from None


def _parse_token_header(token: str) -> dict[str, str]:
    if (
        not isinstance(token, str)
        or not token
        or len(token) > _MAX_TOKEN_BYTES
        or _COMPACT_JWT.fullmatch(token) is None
    ):
        raise InvalidAccessToken
    encoded_header = token.split(".", 1)[0]
    try:
        raw_header = _decode_base64url(encoded_header)
        header = json.loads(
            raw_header.decode("utf-8", errors="strict"),
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=_reject_json_constant,
        )
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        _InvalidJwks,
        ValueError,
    ):
        raise InvalidAccessToken from None
    if not isinstance(header, dict) or frozenset(header) != {
        "alg",
        "typ",
        "kid",
    }:
        raise InvalidAccessToken
    if header.get("alg") != "RS256" or header.get("typ") != "JWT":
        raise InvalidAccessToken
    kid = header.get("kid")
    if not isinstance(kid, str) or _BASE64URL.fullmatch(kid) is None:
        raise InvalidAccessToken
    return {"alg": "RS256", "typ": "JWT", "kid": kid}


def _parse_jwks(document: Any) -> dict[str, rsa.RSAPublicKey]:
    if not isinstance(document, dict) or frozenset(document) != {"keys"}:
        raise _InvalidJwks
    raw_keys = document["keys"]
    if not isinstance(raw_keys, list) or not raw_keys or len(raw_keys) > _MAX_JWKS_KEYS:
        raise _InvalidJwks

    parsed: dict[str, rsa.RSAPublicKey] = {}
    for jwk in raw_keys:
        if not isinstance(jwk, dict) or frozenset(jwk) != _JWK_FIELDS:
            raise _InvalidJwks
        if (
            jwk.get("kty") != "RSA"
            or jwk.get("use") != "sig"
            or jwk.get("alg") != "RS256"
        ):
            raise _InvalidJwks
        kid = jwk.get("kid")
        modulus = jwk.get("n")
        exponent = jwk.get("e")
        if not all(isinstance(value, str) for value in (kid, modulus, exponent)):
            raise _InvalidJwks
        if any(
            _BASE64URL.fullmatch(value) is None for value in (kid, modulus, exponent)
        ):
            raise _InvalidJwks
        if kid != _jwk_thumbprint(modulus, exponent) or kid in parsed:
            raise _InvalidJwks

        n = _decode_base64url_uint(modulus)
        e = _decode_base64url_uint(exponent)
        if not 2048 <= n.bit_length() <= 8192 or n % 2 == 0:
            raise _InvalidJwks
        if e < 3 or e > 2**32 - 1 or e % 2 == 0 or e >= n:
            raise _InvalidJwks
        try:
            parsed[kid] = rsa.RSAPublicNumbers(e=e, n=n).public_key()
        except ValueError:
            raise _InvalidJwks from None
    return parsed


def _decode_base64url(value: str) -> bytes:
    if not isinstance(value, str) or _BASE64URL.fullmatch(value) is None:
        raise ValueError
    try:
        decoded = base64.b64decode(
            value + "=" * (-len(value) % 4),
            altchars=b"-_",
            validate=True,
        )
    except (binascii.Error, ValueError):
        raise ValueError from None
    if _encode_base64url(decoded) != value:
        raise ValueError
    return decoded


def _decode_base64url_uint(value: str) -> int:
    try:
        raw = _decode_base64url(value)
    except ValueError:
        raise _InvalidJwks from None
    if not raw or raw[0] == 0:
        raise _InvalidJwks
    return int.from_bytes(raw, "big", signed=False)


def _jwk_thumbprint(modulus: str, exponent: str) -> str:
    canonical = json.dumps(
        {"e": exponent, "kty": "RSA", "n": modulus},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return _encode_base64url(hashlib.sha256(canonical).digest())


def _encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _parse_uuid4(value: object) -> UUID:
    if not isinstance(value, str):
        raise InvalidAccessToken
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError):
        raise InvalidAccessToken from None
    if parsed.version != 4 or parsed.variant != RFC_4122 or str(parsed) != value:
        raise InvalidAccessToken
    return parsed


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _InvalidJwks
        result[key] = value
    return result


def _reject_json_constant(_value: str) -> None:
    raise _InvalidJwks


def _is_json_content_type(value: str) -> bool:
    parts = value.split(";")
    if parts[0].strip().lower() not in {
        "application/json",
        "application/jwk-set+json",
    }:
        return False
    charset_seen = False
    for parameter in parts[1:]:
        name, separator, raw_value = parameter.partition("=")
        if separator != "=" or name.strip().lower() != "charset" or charset_seen:
            return False
        charset = raw_value.strip().strip('"').lower()
        if charset not in {"utf-8", "utf8"}:
            return False
        charset_seen = True
    return True


def _validate_allowed_hosts(hosts: tuple[str, ...]) -> frozenset[str]:
    if not isinstance(hosts, tuple) or not hosts:
        raise ValueError("allowed_hosts must be a non-empty tuple")
    normalized = frozenset(_normalize_host(host) for host in hosts)
    if len(normalized) != len(hosts):
        raise ValueError("allowed_hosts must not contain duplicates")
    return normalized


def _normalize_host(host: str) -> str:
    if not isinstance(host, str) or not host or host != host.strip():
        raise ValueError("allowed_hosts contains an invalid host")
    if any(character.isspace() for character in host) or any(
        character in host for character in "/@?#"
    ):
        raise ValueError("allowed_hosts contains an invalid host")
    try:
        return ipaddress.ip_address(host).compressed.lower()
    except ValueError:
        pass
    if ":" in host or host.endswith("."):
        raise ValueError("allowed_hosts contains an invalid host")
    try:
        ascii_host = host.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise ValueError("allowed_hosts contains an invalid host") from None
    if ascii_host != host.lower() or len(ascii_host) > 253:
        raise ValueError("allowed_hosts contains an invalid host")
    labels = ascii_host.split(".")
    if any(
        not label
        or len(label) > 63
        or re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label) is None
        for label in labels
    ):
        raise ValueError("allowed_hosts contains an invalid host")
    return ascii_host


def _validate_jwks_uri(
    value: str,
    allowed_hosts: frozenset[str],
    allow_insecure_http: bool,
) -> str:
    if not isinstance(allow_insecure_http, bool):
        raise ValueError("allow_insecure_http must be boolean")
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError("jwks_uri must be an absolute URL")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise ValueError("jwks_uri must be an absolute URL") from None
    if (
        parsed.scheme not in {"https", "http"}
        or not parsed.netloc
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith("/")
        or port == 0
    ):
        raise ValueError("jwks_uri must be a fixed HTTP(S) URL")
    if parsed.scheme == "http" and not allow_insecure_http:
        raise ValueError("jwks_uri must use HTTPS")
    if _normalize_host(parsed.hostname) not in allowed_hosts:
        raise ValueError("jwks_uri host is not allowlisted")
    return value


def _validate_claim_configuration(name: str, value: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _positive_finite(name: str, value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{name} must be positive and finite")
    converted = float(value)
    if converted <= 0 or not math.isfinite(converted):
        raise ValueError(f"{name} must be positive and finite")
    return converted
