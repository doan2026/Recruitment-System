package com.recruitment.admin.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.server.resource.authentication.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.*;

@Configuration
public class SecurityConfig {

  @Bean
  JwtDecoder decoder(
    @Value("${admin.jwt.jwks-uri}") String uri,
    @Value("${admin.jwt.issuer}") String issuer,
    @Value("${admin.jwt.audience}") String audience
  ) {
    var decoder = NimbusJwtDecoder.withJwkSetUri(uri)
      .jwsAlgorithm(SignatureAlgorithm.RS256)
      .build();
    OAuth2TokenValidator<Jwt> claims = jwt -> {
      try {
        UUID.fromString(jwt.getSubject());
        if (
          !jwt.getAudience().contains(audience) ||
          jwt.getIssuedAt() == null ||
          jwt.getExpiresAt() == null ||
          !jwt.getExpiresAt().isAfter(jwt.getIssuedAt()) ||
          jwt.getIssuedAt().isAfter(java.time.Instant.now().plusSeconds(60)) ||
          !Set.of("ADMIN", "CANDIDATE", "RECRUITER").contains(
            jwt.getClaimAsString("role")
          )
        ) throw new IllegalArgumentException();
        return OAuth2TokenValidatorResult.success();
      } catch (RuntimeException e) {
        return OAuth2TokenValidatorResult.failure(
          new OAuth2Error("invalid_token")
        );
      }
    };
    decoder.setJwtValidator(
      new DelegatingOAuth2TokenValidator<>(
        JwtValidators.createDefaultWithIssuer(issuer),
        claims
      )
    );
    return decoder;
  }

  @Bean
  SecurityFilterChain security(
    HttpSecurity http,
    ObjectMapper mapper,
    @Value("${springdoc.api-docs.enabled:false}") boolean docs
  ) throws Exception {
    var roles = new JwtGrantedAuthoritiesConverter();
    roles.setAuthoritiesClaimName("role");
    roles.setAuthorityPrefix("ROLE_");
    var converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(roles);
    http
      .csrf(c -> c.disable())
      .cors(c -> {})
      .sessionManagement(s ->
        s.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
      )
      .authorizeHttpRequests(a -> {
        a
          .requestMatchers("/health", "/actuator/health", "/actuator/health/**")
          .permitAll();
        if (docs) a
          .requestMatchers(
            "/v3/api-docs/**",
            "/swagger-ui/**",
            "/swagger-ui.html"
          )
          .permitAll();
        a.requestMatchers(HttpMethod.POST, "/reports").authenticated();
        a.anyRequest().hasRole("ADMIN");
      })
      .oauth2ResourceServer(o ->
        o
          .jwt(j -> j.jwtAuthenticationConverter(converter))
          .authenticationEntryPoint((q, s, e) ->
            error(mapper, s, 401, "AUTHENTICATION_REQUIRED")
          )
          .accessDeniedHandler((q, s, e) ->
            error(mapper, s, 403, "ACCESS_DENIED")
          )
      );
    return http.build();
  }

  private static void error(
    ObjectMapper m,
    jakarta.servlet.http.HttpServletResponse s,
    int status,
    String code
  ) throws java.io.IOException {
    s.setStatus(status);
    s.setContentType("application/json");
    m.writeValue(
      s.getOutputStream(),
      Map.of("code", code, "message", code, "details", Map.of())
    );
  }

  @Bean
  CorsConfigurationSource cors(@Value("${admin.cors-origins}") String origins) {
    var c = new CorsConfiguration();
    c.setAllowedOrigins(
      Arrays.stream(origins.split(",")).map(String::trim).toList()
    );
    c.setAllowedMethods(List.of("GET", "POST", "PATCH", "OPTIONS"));
    c.setAllowedHeaders(
      List.of("Authorization", "Content-Type", "X-Request-ID")
    );
    c.setExposedHeaders(List.of("X-Request-ID", "Content-Disposition"));
    var source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", c);
    return source;
  }
}
