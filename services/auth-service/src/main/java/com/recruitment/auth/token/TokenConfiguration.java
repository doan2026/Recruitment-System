package com.recruitment.auth.token;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.proc.DefaultJOSEObjectTypeVerifier;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import java.security.SecureRandom;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ResourceLoader;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(TokenProperties.class)
class TokenConfiguration {
  private static final JOSEObjectType ACCESS_TOKEN_TYPE = JOSEObjectType.JWT;

  @Bean
  RsaTokenKeys rsaTokenKeys(TokenProperties properties, ResourceLoader resources) {
    return RsaTokenKeys.load(properties, resources, new SecureRandom());
  }

  @Bean
  JwtDecoder jwtDecoder(RsaTokenKeys keys, TokenProperties properties) {
    DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
    processor.setJWSTypeVerifier(new DefaultJOSEObjectTypeVerifier<>(ACCESS_TOKEN_TYPE));
    processor.setJWSKeySelector((header, context) -> {
      if (!JWSAlgorithm.RS256.equals(header.getAlgorithm())
          || header.getKeyID() == null
          || header.getKeyID().isBlank()) {
        return List.of();
      }
      var publicKey = keys.publicKey(header.getKeyID());
      return publicKey == null ? List.of() : List.of(publicKey);
    });

    NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
    OAuth2TokenValidator<Jwt> standard =
        JwtValidators.createDefaultWithIssuer(properties.getIssuer());
    OAuth2TokenValidator<Jwt> contract = token -> validateContract(token, properties);
    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(standard, contract));
    return decoder;
  }

  private static OAuth2TokenValidatorResult validateContract(
      Jwt token, TokenProperties properties) {
    if (!token.getAudience().contains(properties.getAudience())) {
      return invalid("JWT audience is invalid");
    }
    if (token.getIssuedAt() == null || token.getExpiresAt() == null) {
      return invalid("JWT temporal claims are required");
    }
    try {
      UUID.fromString(token.getSubject());
      UUID.fromString(token.getId());
    } catch (RuntimeException exception) {
      return invalid("JWT sub and jti must be UUID values");
    }
    Object role = token.getClaims().get("role");
    if (!(role instanceof String roleName)
        || !List.of("CANDIDATE", "RECRUITER", "ADMIN").contains(roleName)) {
      return invalid("JWT role is invalid");
    }
    Object keyId = token.getHeaders().get("kid");
    if (!(keyId instanceof String value) || value.isBlank()) {
      return invalid("JWT kid is required");
    }
    return OAuth2TokenValidatorResult.success();
  }

  private static OAuth2TokenValidatorResult invalid(String description) {
    return OAuth2TokenValidatorResult.failure(
        new OAuth2Error("invalid_token", description, null));
  }
}
