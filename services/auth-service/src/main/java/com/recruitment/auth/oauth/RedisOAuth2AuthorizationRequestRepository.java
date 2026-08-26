package com.recruitment.auth.oauth;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.oauth2.client.web.AuthorizationRequestRepository;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.stereotype.Component;

@Component
public final class RedisOAuth2AuthorizationRequestRepository
    implements AuthorizationRequestRepository<OAuth2AuthorizationRequest> {

  static final String COOKIE_NAME = "oauth2_authorization";
  static final String COOKIE_PATH = "/auth/google/callback";
  private static final String KEY_PREFIX = "auth:google:authorization-request:v1:";
  private static final int MAX_INSTALL_ATTEMPTS = 4;

  private static final DefaultRedisScript<String> CONSUME_MATCHING_STATE =
      new DefaultRedisScript<>("""
          local value = redis.call('GET', KEYS[1])
          if not value then
            return nil
          end
          local ok, decoded = pcall(cjson.decode, value)
          if not ok then
            redis.call('DEL', KEYS[1])
            return nil
          end
          if not ARGV[1] or decoded.state ~= ARGV[1] then
            return nil
          end
          redis.call('DEL', KEYS[1])
          return value
          """, String.class);

  private final StringRedisTemplate redis;
  private final ObjectMapper objectMapper;
  private final GoogleOAuthTokenCodec tokenCodec;
  private final GoogleOAuthProperties properties;

  public RedisOAuth2AuthorizationRequestRepository(
      StringRedisTemplate redis,
      ObjectMapper objectMapper,
      GoogleOAuthTokenCodec tokenCodec,
      GoogleOAuthProperties properties) {
    this.redis = Objects.requireNonNull(redis, "redis is required");
    this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper is required");
    this.tokenCodec = Objects.requireNonNull(tokenCodec, "tokenCodec is required");
    this.properties = Objects.requireNonNull(properties, "properties are required");
  }

  @Override
  public OAuth2AuthorizationRequest loadAuthorizationRequest(HttpServletRequest request) {
    String handle = readCookie(request);
    if (handle == null) {
      return null;
    }
    String serialized = redis.opsForValue().get(key(handle));
    return deserialize(serialized);
  }

  @Override
  public void saveAuthorizationRequest(
      OAuth2AuthorizationRequest authorizationRequest,
      HttpServletRequest request,
      HttpServletResponse response) {
    if (authorizationRequest == null) {
      removeAuthorizationRequest(request, response);
      return;
    }
    StoredAuthorizationRequest stored = StoredAuthorizationRequest.from(authorizationRequest);
    String serialized = serialize(stored);
    Duration ttl = properties.authorizationRequestTtl();
    for (int attempt = 0; attempt < MAX_INSTALL_ATTEMPTS; attempt++) {
      String handle = tokenCodec.generate();
      Boolean installed = redis.opsForValue().setIfAbsent(key(handle), serialized, ttl);
      if (Boolean.TRUE.equals(installed)) {
        response.addHeader(HttpHeaders.SET_COOKIE, authorizationCookie(handle, ttl).toString());
        return;
      }
    }
    throw new IllegalStateException("could not reserve a Google authorization request");
  }

  @Override
  public OAuth2AuthorizationRequest removeAuthorizationRequest(
      HttpServletRequest request,
      HttpServletResponse response) {
    String handle = readCookie(request);
    String presentedState = request.getParameter("state");
    if (handle == null || presentedState == null || presentedState.isBlank()) {
      return null;
    }
    String serialized = redis.execute(
        CONSUME_MATCHING_STATE,
        List.of(key(handle)),
        presentedState);
    if (serialized != null) {
      response.addHeader(HttpHeaders.SET_COOKIE, expiredAuthorizationCookie().toString());
    }
    return deserialize(serialized);
  }

  void delete(HttpServletRequest request, HttpServletResponse response) {
    String handle = readCookie(request);
    if (handle != null) {
      redis.delete(key(handle));
    }
    response.addHeader(HttpHeaders.SET_COOKIE, expiredAuthorizationCookie().toString());
  }

  private String key(String handle) {
    return KEY_PREFIX + tokenCodec.digest(handle);
  }

  private String readCookie(HttpServletRequest request) {
    Cookie[] cookies = request.getCookies();
    if (cookies == null) {
      return null;
    }
    for (Cookie cookie : cookies) {
      if (COOKIE_NAME.equals(cookie.getName())) {
        try {
          return tokenCodec.requireToken(cookie.getValue());
        } catch (IllegalArgumentException malformed) {
          return null;
        }
      }
    }
    return null;
  }

  private ResponseCookie authorizationCookie(String handle, Duration ttl) {
    return cookie(handle, ttl);
  }

  private ResponseCookie expiredAuthorizationCookie() {
    return cookie("", Duration.ZERO);
  }

  private ResponseCookie cookie(String value, Duration maxAge) {
    return ResponseCookie.from(COOKIE_NAME, value)
        .httpOnly(true)
        .secure(properties.secureCookies())
        .sameSite("Lax")
        .path(COOKIE_PATH)
        .maxAge(maxAge)
        .build();
  }

  private String serialize(StoredAuthorizationRequest value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("could not serialize Google authorization request", exception);
    }
  }

  private OAuth2AuthorizationRequest deserialize(String value) {
    if (value == null) {
      return null;
    }
    try {
      return objectMapper.readValue(value, StoredAuthorizationRequest.class)
          .toAuthorizationRequest();
    } catch (JsonProcessingException | IllegalArgumentException exception) {
      return null;
    }
  }

  record StoredAuthorizationRequest(
      String authorizationUri,
      String clientId,
      String redirectUri,
      Set<String> scopes,
      String state,
      Map<String, String> additionalParameters,
      Map<String, String> attributes,
      String authorizationRequestUri) {

    StoredAuthorizationRequest {
      scopes = scopes == null ? Set.of() : Set.copyOf(scopes);
      additionalParameters = additionalParameters == null
          ? Map.of()
          : Map.copyOf(additionalParameters);
      attributes = attributes == null ? Map.of() : Map.copyOf(attributes);
    }

    static StoredAuthorizationRequest from(OAuth2AuthorizationRequest request) {
      return new StoredAuthorizationRequest(
          requireText(request.getAuthorizationUri(), "authorizationUri"),
          requireText(request.getClientId(), "clientId"),
          requireText(request.getRedirectUri(), "redirectUri"),
          new LinkedHashSet<>(request.getScopes()),
          requireText(request.getState(), "state"),
          scalarMap(request.getAdditionalParameters()),
          scalarMap(request.getAttributes()),
          requireText(request.getAuthorizationRequestUri(), "authorizationRequestUri"));
    }

    OAuth2AuthorizationRequest toAuthorizationRequest() {
      Map<String, Object> restoredAdditionalParameters = new LinkedHashMap<>();
      restoredAdditionalParameters.putAll(additionalParameters);
      Map<String, Object> restoredAttributes = new LinkedHashMap<>();
      restoredAttributes.putAll(attributes);
      return OAuth2AuthorizationRequest.authorizationCode()
          .authorizationUri(requireText(authorizationUri, "authorizationUri"))
          .clientId(requireText(clientId, "clientId"))
          .redirectUri(requireText(redirectUri, "redirectUri"))
          .scopes(scopes)
          .state(requireText(state, "state"))
          .additionalParameters(restoredAdditionalParameters)
          .attributes(restoredAttributes)
          .authorizationRequestUri(
              requireText(authorizationRequestUri, "authorizationRequestUri"))
          .build();
    }

    private static Map<String, String> scalarMap(Map<String, Object> values) {
      Map<String, String> result = new LinkedHashMap<>();
      values.forEach((key, value) -> {
        if (key != null && value instanceof String stringValue) {
          result.put(key, stringValue);
        }
      });
      return result;
    }

    private static String requireText(String value, String field) {
      if (value == null || value.isBlank()) {
        throw new IllegalArgumentException(field + " is required");
      }
      return value;
    }
  }
}
