package com.recruitment.auth.security.oauth;

import jakarta.servlet.http.HttpServletRequest;
import com.recruitment.auth.dto.oauth.GoogleOAuthRole;
import java.util.Objects;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;

final class GooglePkceAuthorizationRequestResolver
    implements OAuth2AuthorizationRequestResolver {

  static final String PORTAL_ROLE_ATTRIBUTE = "recruitment_google_portal_role";

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
    return withPortalRole(requireGoogle(delegate.resolve(request)), request);
  }

  @Override
  public OAuth2AuthorizationRequest resolve(
      HttpServletRequest request,
      String clientRegistrationId) {
    if (!"google".equals(clientRegistrationId)) {
      return null;
    }
    return withPortalRole(requireGoogle(delegate.resolve(request, clientRegistrationId)), request);
  }

  private OAuth2AuthorizationRequest withPortalRole(
      OAuth2AuthorizationRequest authorization, HttpServletRequest request) {
    if (authorization == null) return null;
    String value = request.getParameter("role");
    final GoogleOAuthRole role;
    try {
      role = value == null ? GoogleOAuthRole.CANDIDATE : GoogleOAuthRole.valueOf(value);
    } catch (IllegalArgumentException invalidRole) {
      throw new OAuth2AuthenticationException(new OAuth2Error(OAuth2ErrorCodes.INVALID_REQUEST), "Invalid Google sign-in portal");
    }
    // An attribute is stored with state in Redis, never sent as a Google claim.
    return OAuth2AuthorizationRequest.from(authorization)
        .attributes(attributes -> attributes.put(PORTAL_ROLE_ATTRIBUTE, role.name()))
        .build();
  }

  private OAuth2AuthorizationRequest requireGoogle(OAuth2AuthorizationRequest request) {
    if (request == null) {
      return null;
    }
    Object registrationId = request.getAttribute("registration_id");
    return "google".equals(registrationId) ? request : null;
  }
}
