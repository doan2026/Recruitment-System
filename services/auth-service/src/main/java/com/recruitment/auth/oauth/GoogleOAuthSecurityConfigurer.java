package com.recruitment.auth.oauth;

import java.util.Objects;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.stereotype.Component;

@Component
public final class GoogleOAuthSecurityConfigurer {
  public static final String AUTHORIZATION_BASE_URI = "/auth/oauth2/authorization";
  public static final String GOOGLE_AUTHORIZATION_URI =
      AUTHORIZATION_BASE_URI + "/google";
  public static final String CALLBACK_URI = "/auth/google/callback";

  private final GoogleOAuthProperties properties;
  private final ObjectProvider<ClientRegistrationRepository> clientRepositories;
  private final RedisOAuth2AuthorizationRequestRepository authorizationRequests;
  private final NoOpOAuth2AuthorizedClientRepository authorizedClients;
  private final GoogleOAuthAuthenticationSuccessHandler successHandler;
  private final GoogleOAuthAuthenticationFailureHandler failureHandler;

  public GoogleOAuthSecurityConfigurer(
      GoogleOAuthProperties properties,
      ObjectProvider<ClientRegistrationRepository> clientRepositories,
      RedisOAuth2AuthorizationRequestRepository authorizationRequests,
      NoOpOAuth2AuthorizedClientRepository authorizedClients,
      GoogleOAuthAuthenticationSuccessHandler successHandler,
      GoogleOAuthAuthenticationFailureHandler failureHandler) {
    this.properties = Objects.requireNonNull(properties, "properties are required");
    this.clientRepositories = Objects.requireNonNull(
        clientRepositories, "clientRepositories are required");
    this.authorizationRequests = Objects.requireNonNull(
        authorizationRequests, "authorizationRequests are required");
    this.authorizedClients = Objects.requireNonNull(
        authorizedClients, "authorizedClients are required");
    this.successHandler = Objects.requireNonNull(successHandler, "successHandler is required");
    this.failureHandler = Objects.requireNonNull(failureHandler, "failureHandler is required");
  }

  public boolean enabled() {
    return properties.enabled();
  }

  public void configure(HttpSecurity http) throws Exception {
    if (!properties.enabled()) {
      return;
    }
    properties.validateEnabledConfiguration();
    ClientRegistrationRepository clients = clientRepositories.getIfAvailable();
    if (clients == null) {
      throw new IllegalStateException(
          "Google OAuth is enabled but no ClientRegistrationRepository is configured");
    }
    GooglePkceAuthorizationRequestResolver resolver =
        new GooglePkceAuthorizationRequestResolver(clients, AUTHORIZATION_BASE_URI);
    http.oauth2Login(oauth -> oauth
        .clientRegistrationRepository(clients)
        .loginPage("/auth/google")
        .authorizationEndpoint(endpoint -> endpoint
            .baseUri(AUTHORIZATION_BASE_URI)
            .authorizationRequestResolver(resolver)
            .authorizationRequestRepository(authorizationRequests))
        .redirectionEndpoint(endpoint -> endpoint.baseUri(CALLBACK_URI))
        .authorizedClientRepository(authorizedClients)
        .successHandler(successHandler)
        .failureHandler(failureHandler));
  }
}
