package com.recruitment.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

class AdminAccountControlCorsTest {
  private static final String ADMIN_ORIGIN = "https://admin.example.com";

  @Test
  void internalAccountControlDoesNotOpenPatchToBrowserOrigins() {
    CorsConfigurationSource source = new SecurityConfig().corsConfigurationSource(
        new AuthCorsProperties(List.of(ADMIN_ORIGIN)));
    MockHttpServletRequest request = new MockHttpServletRequest(
        HttpMethod.OPTIONS.name(),
        "/auth/users/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/lock");

    CorsConfiguration configuration = source.getCorsConfiguration(request);

    assertThat(configuration).isNotNull();
    assertThat(configuration.getAllowedMethods())
        .contains(HttpMethod.OPTIONS.name())
        .doesNotContain(HttpMethod.PATCH.name());
    assertThat(configuration.getAllowedHeaders())
        .contains(HttpHeaders.AUTHORIZATION, HttpHeaders.CONTENT_TYPE);
    assertThat(configuration.getAllowCredentials()).isTrue();
    assertThat(configuration.checkOrigin(ADMIN_ORIGIN)).isEqualTo(ADMIN_ORIGIN);
    assertThat(configuration.checkOrigin("https://attacker.example"))
        .isNull();
  }
}
