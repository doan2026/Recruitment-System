package com.recruitment.interview.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

class InterviewSecurityPropertiesTest {
  @Test
  void acceptsExactHttpsAndLoopbackDevelopmentOrigins() {
    var properties = InterviewCorsProperties.parse(
        "https://recruitment.example,http://localhost:3000,http://127.0.0.1:5173");

    assertThat(properties.allowedOrigins()).containsExactly(
        "https://recruitment.example",
        "http://localhost:3000",
        "http://127.0.0.1:5173");
  }

  @Test
  void deDuplicatesOriginsWithoutCreatingPatterns() {
    var properties = InterviewCorsProperties.parse(
        "https://recruitment.example, https://recruitment.example");

    assertThat(properties.allowedOrigins()).containsExactly("https://recruitment.example");
  }

  @Test
  void rejectsWildcardUnsafeHttpAndNonOriginValues() {
    List<String> invalidValues = List.of(
        "*",
        "https://*.example.com",
        "http://recruitment.example",
        "https://recruitment.example/path",
        "https://user@recruitment.example",
        "https://recruitment.example?x=1",
        "https://recruitment.example#fragment",
        "https://recruitment.example,");

    for (String invalid : invalidValues) {
      assertThatThrownBy(() -> InterviewCorsProperties.parse(invalid))
          .as(invalid)
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageStartingWith("CORS_ORIGINS");
    }
  }

  @Test
  void jwtSettingsRejectWhitespaceAndControlCharacters() {
    assertThatThrownBy(() -> new InterviewJwtProperties(" /key.pem", "issuer", "audience"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new InterviewJwtProperties("/key.pem", "issuer\n", "audience"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
