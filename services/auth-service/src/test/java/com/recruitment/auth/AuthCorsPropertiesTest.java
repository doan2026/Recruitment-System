package com.recruitment.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class AuthCorsPropertiesTest {
  @Test
  void trimsDeduplicatesAndKeepsExactAllowedOrigins() {
    AuthCorsProperties properties = new AuthCorsProperties(List.of(
        " http://localhost:3000 ",
        "https://app.example.com",
        "http://localhost:3000"));

    assertThat(properties.allowedOrigins())
        .containsExactly("http://localhost:3000", "https://app.example.com");
  }

  @ParameterizedTest
  @NullSource
  @ValueSource(strings = {
      "",
      "*",
      "http://app.example.com",
      "ftp://app.example.com",
      "https://app.example.com/",
      "https://app.example.com/path",
      "https://app.example.com?query=yes",
      "https://app.example.com#fragment",
      "https://user@app.example.com",
      "not-an-origin"
  })
  void rejectsWildcardMalformedOrUnsafeOrigins(String origin) {
    List<String> origins = origin == null ? null : List.of(origin);

    assertThatThrownBy(() -> new AuthCorsProperties(origins))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageStartingWith("auth.cors.allowed-origins");
  }
}
