package com.recruitment.interview.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class SecurityConfigTest {
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final SecurityConfig config = new SecurityConfig();

  @Test
  void writesGenericNoStoreAuthenticationError() throws Exception {
    MockHttpServletResponse response = new MockHttpServletResponse();

    SecurityConfig.writeSecurityError(
        objectMapper, response, 401, "AUTHENTICATION_REQUIRED", "A valid access token is required");

    assertThat(response.getStatus()).isEqualTo(401);
    assertThat(response.getHeader(HttpHeaders.CACHE_CONTROL)).isEqualTo("no-store");
    assertThat(response.getHeader(HttpHeaders.PRAGMA)).isEqualTo("no-cache");
    assertThat(response.getHeader(HttpHeaders.WWW_AUTHENTICATE)).isEqualTo("Bearer");
    JsonNode body = objectMapper.readTree(response.getContentAsString(StandardCharsets.UTF_8));
    assertThat(body.get("code").asText()).isEqualTo("AUTHENTICATION_REQUIRED");
    assertThat(body.get("details").isObject()).isTrue();
    assertThat(body.toString()).doesNotContain("exception", "stackTrace");
  }

  @Test
  void writesGenericNoStoreAccessDeniedErrorWithoutAuthenticationChallenge()
      throws Exception {
    MockHttpServletResponse response = new MockHttpServletResponse();

    SecurityConfig.writeSecurityError(
        objectMapper, response, 403, "ACCESS_DENIED", "Access is denied");

    assertThat(response.getStatus()).isEqualTo(403);
    assertThat(response.getHeader(HttpHeaders.CACHE_CONTROL)).isEqualTo("no-store");
    assertThat(response.getHeader(HttpHeaders.WWW_AUTHENTICATE)).isNull();
    assertThat(objectMapper.readTree(response.getContentAsByteArray()).get("code").asText())
        .isEqualTo("ACCESS_DENIED");
  }

  @Test
  void corsUsesExactOriginMatchingAndExpectedHeaders() {
    var source = config.corsConfigurationSource(
        InterviewCorsProperties.parse("https://recruitment.example,http://localhost:3000"));
    var request = new MockHttpServletRequest("OPTIONS", "/interviews");
    var cors = source.getCorsConfiguration(request);

    assertThat(cors).isNotNull();
    assertThat(cors.checkOrigin("https://recruitment.example"))
        .isEqualTo("https://recruitment.example");
    assertThat(cors.checkOrigin("https://evil.example")).isNull();
    assertThat(cors.getAllowedOriginPatterns()).isNullOrEmpty();
    assertThat(cors.getAllowedHeaders()).containsExactly(
        HttpHeaders.AUTHORIZATION, HttpHeaders.CONTENT_TYPE, HttpHeaders.ACCEPT);
    assertThat(cors.getAllowCredentials()).isTrue();
  }
}
