package com.recruitment.auth.oauth;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.endpoint.PkceParameterNames;
import org.springframework.security.oauth2.core.oidc.endpoint.OidcParameterNames;

class GooglePkceAuthorizationRequestResolverTest {

  @Test
  void addsStateOidcNonceAndPkceForConfidentialGoogleClient() throws Exception {
    GooglePkceAuthorizationRequestResolver resolver = resolver();
    MockHttpServletRequest request = new MockHttpServletRequest(
        "GET", GoogleOAuthSecurityConfigurer.GOOGLE_AUTHORIZATION_URI);
    request.setServletPath(GoogleOAuthSecurityConfigurer.GOOGLE_AUTHORIZATION_URI);

    OAuth2AuthorizationRequest authorization = resolver.resolve(request);

    assertThat(authorization).isNotNull();
    assertThat(authorization.getState()).isNotBlank();
    assertThat(authorization.<String>getAttribute(OidcParameterNames.NONCE)).isNotBlank();
    assertThat(authorization.getAdditionalParameters())
        .containsKeys(
            OidcParameterNames.NONCE,
            PkceParameterNames.CODE_CHALLENGE,
            PkceParameterNames.CODE_CHALLENGE_METHOD)
        .containsEntry(PkceParameterNames.CODE_CHALLENGE_METHOD, "S256");
    assertThat(authorization.<String>getAttribute(PkceParameterNames.CODE_VERIFIER))
        .isNotBlank();
    assertThat(authorization.getAuthorizationRequestUri())
        .contains("code_challenge=", "code_challenge_method=S256", "nonce=");
  }

  @Test
  void redisJsonRoundTripPreservesNonceAndPkceVerifierForSpringValidation()
      throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest(
        "GET", GoogleOAuthSecurityConfigurer.GOOGLE_AUTHORIZATION_URI);
    request.setServletPath(GoogleOAuthSecurityConfigurer.GOOGLE_AUTHORIZATION_URI);
    OAuth2AuthorizationRequest original = resolver().resolve(request);
    ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

    RedisOAuth2AuthorizationRequestRepository.StoredAuthorizationRequest stored =
        RedisOAuth2AuthorizationRequestRepository.StoredAuthorizationRequest.from(original);
    String json = mapper.writeValueAsString(stored);
    OAuth2AuthorizationRequest restored = mapper.readValue(
            json,
            RedisOAuth2AuthorizationRequestRepository.StoredAuthorizationRequest.class)
        .toAuthorizationRequest();

    assertThat(restored.<String>getAttribute(OidcParameterNames.NONCE))
        .isEqualTo(original.getAttribute(OidcParameterNames.NONCE));
    assertThat(restored.<String>getAttribute(PkceParameterNames.CODE_VERIFIER))
        .isEqualTo(original.getAttribute(PkceParameterNames.CODE_VERIFIER));
    assertThat(restored.getAdditionalParameters())
        .containsEntry(
            OidcParameterNames.NONCE,
            original.getAdditionalParameters().get(OidcParameterNames.NONCE))
        .containsEntry(
            PkceParameterNames.CODE_CHALLENGE,
            original.getAdditionalParameters().get(PkceParameterNames.CODE_CHALLENGE));
    assertThat(json).doesNotContain("java.util", "@class");
  }

  private static GooglePkceAuthorizationRequestResolver resolver() {
    ClientRegistration google = ClientRegistration.withRegistrationId("google")
        .clientId("client-id")
        .clientSecret("client-secret")
        .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
        .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
        .redirectUri("https://auth.example.com/auth/google/callback")
        .scope(List.of("openid", "profile", "email"))
        .authorizationUri("https://accounts.google.test/o/oauth2/v2/auth")
        .tokenUri("https://oauth2.google.test/token")
        .jwkSetUri("https://oauth2.google.test/certs")
        .issuerUri("https://accounts.google.test")
        .userInfoUri("https://openidconnect.google.test/v1/userinfo")
        .userNameAttributeName("sub")
        .clientName("Google")
        .build();
    return new GooglePkceAuthorizationRequestResolver(
        new InMemoryClientRegistrationRepository(google),
        GoogleOAuthSecurityConfigurer.AUTHORIZATION_BASE_URI);
  }
}
