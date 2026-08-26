package com.recruitment.auth.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class AdminAccountControlResponseHeadersFilterTest {
  @Test
  void dynamicAccountControlPathIsNoStoreForSuccessAndErrorResponses()
      throws Exception {
    assertNoStore("/auth/users/" + UUID.randomUUID() + "/lock");
  }

  @Test
  void matrixParameterVariantCannotBypassSensitiveResponseHeaders()
      throws Exception {
    assertNoStore("/auth/users;probe=1/" + UUID.randomUUID() + "/lock");
  }

  private static void assertNoStore(String path) throws Exception {
    SensitiveAuthResponseHeadersFilter filter =
        new SensitiveAuthResponseHeadersFilter();
    MockHttpServletRequest request = new MockHttpServletRequest(
        "PATCH",
        path);
    MockHttpServletResponse response = new MockHttpServletResponse();

    filter.doFilter(request, response, new MockFilterChain());

    assertThat(response.getHeader(HttpHeaders.CACHE_CONTROL))
        .isEqualTo("no-store, no-cache");
    assertThat(response.getHeader(HttpHeaders.PRAGMA)).isEqualTo("no-cache");
    assertThat(response.getHeader(HttpHeaders.EXPIRES)).isEqualTo("0");
  }
}
