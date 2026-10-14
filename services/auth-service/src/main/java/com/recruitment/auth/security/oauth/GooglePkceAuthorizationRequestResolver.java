package com.recruitment.auth.security.oauth;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Objects;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;

final class GooglePkceAuthorizationRequestResolver
    implements OAuth2AuthorizationRequestResolver {

  private final DefaultOAuth2AuthorizationRequestResolver delegate;

  GooglePkceAuthorizationRequestResolver(
      ClientRegistrationRepository clients,
      String authorizationRequestBaseUri) {
    delegate = new DefaultOAuth2AuthorizationRequestResolver(
        Objects.requireNonNull(clients, "clients are required"),
        authorizationRequestBaseUri);
    delegate.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
  }

  @Override
  public OAuth2AuthorizationRequest resolve(HttpServletRequest request) {
    return requireGoogle(delegate.resolve(request));
  }

  @Override
  public OAuth2AuthorizationRequest resolve(
      HttpServletRequest request,
      String clientRegistrationId) {
    if (!"google".equals(clientRegistrationId)) {
      return null;
    }
    return requireGoogle(delegate.resolve(request, clientRegistrationId));
  }

  private OAuth2AuthorizationRequest requireGoogle(OAuth2AuthorizationRequest request) {
    if (request == null) {
      return null;
    }
    Object registrationId = request.getAttribute("registration_id");
    return "google".equals(registrationId) ? request : null;
  }
}
