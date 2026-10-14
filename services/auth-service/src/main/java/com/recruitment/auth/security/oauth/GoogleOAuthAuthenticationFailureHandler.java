package com.recruitment.auth.security.oauth;

import com.recruitment.auth.config.properties.GoogleOAuthProperties;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Objects;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;

@Component
final class GoogleOAuthAuthenticationFailureHandler
    implements AuthenticationFailureHandler {

  private final GoogleOAuthProperties properties;

  GoogleOAuthAuthenticationFailureHandler(GoogleOAuthProperties properties) {
    this.properties = Objects.requireNonNull(properties, "properties are required");
  }

  @Override
  public void onAuthenticationFailure(
      HttpServletRequest request,
      HttpServletResponse response,
      AuthenticationException exception) throws IOException, ServletException {
    GoogleOAuthAuthenticationSuccessHandler.setNoStore(response);
    response.setStatus(HttpStatus.FOUND.value());
    response.setHeader(
        HttpHeaders.LOCATION,
        properties.validatedFrontendRedirectUri()
            + "#error=GOOGLE_AUTHENTICATION_FAILED");
  }
}
