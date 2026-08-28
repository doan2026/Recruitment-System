package com.recruitment.interview.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration(proxyBeanMethods = false)
@EnableMethodSecurity
class SecurityConfig {
  @Bean
  InterviewCorsProperties interviewCorsProperties(
      @Value("${CORS_ORIGINS:http://localhost:3000}") String configuredOrigins
  ) {
    return InterviewCorsProperties.parse(configuredOrigins);
  }

  @Bean
  SecurityFilterChain securityFilterChain(
      HttpSecurity http,
      ObjectMapper objectMapper
  ) throws Exception {
    return http
        .csrf(csrf -> csrf.disable())
        .cors(Customizer.withDefaults())
        .sessionManagement(session ->
            session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .requestCache(cache -> cache.disable())
        .formLogin(form -> form.disable())
        .httpBasic(basic -> basic.disable())
        .logout(logout -> logout.disable())
        .authorizeHttpRequests(auth -> auth
            .requestMatchers(
                "/health",
                "/actuator/health",
                "/actuator/health/**",
                "/actuator/info",
                "/docs",
                "/docs/**",
                "/swagger-ui/**",
                "/v3/api-docs",
                "/v3/api-docs/**")
            .permitAll()
            .anyRequest().authenticated())
        .oauth2ResourceServer(oauth -> oauth
            .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter()))
            .authenticationEntryPoint((request, response, exception) ->
                writeSecurityError(
                    objectMapper,
                    response,
                    HttpServletResponse.SC_UNAUTHORIZED,
                    "AUTHENTICATION_REQUIRED",
                    "A valid access token is required"))
            .accessDeniedHandler((request, response, exception) ->
                writeSecurityError(
                    objectMapper,
                    response,
                    HttpServletResponse.SC_FORBIDDEN,
                    "ACCESS_DENIED",
                    "Access is denied")))
        .build();
  }

  @Bean
  CorsConfigurationSource corsConfigurationSource(InterviewCorsProperties properties) {
    CorsConfiguration configuration = new CorsConfiguration();
    configuration.setAllowedOrigins(properties.allowedOrigins());
    configuration.setAllowedMethods(List.of(
        "GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"));
    configuration.setAllowedHeaders(List.of(
        HttpHeaders.AUTHORIZATION,
        HttpHeaders.CONTENT_TYPE,
        HttpHeaders.ACCEPT));
    configuration.setExposedHeaders(List.of(
        HttpHeaders.LOCATION,
        HttpHeaders.ETAG,
        "Idempotency-Replayed"));
    configuration.setAllowCredentials(true);
    configuration.setMaxAge(600L);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", configuration);
    return source;
  }

  private Converter<Jwt, JwtAuthenticationToken> jwtAuthenticationConverter() {
    return jwt -> new JwtAuthenticationToken(
        jwt,
        List.of(new SimpleGrantedAuthority("ROLE_" + jwt.getClaimAsString("role"))),
        jwt.getSubject());
  }

  static void writeSecurityError(
      ObjectMapper objectMapper,
      HttpServletResponse response,
      int status,
      String code,
      String message
  ) throws IOException {
    response.setStatus(status);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    response.setHeader(HttpHeaders.PRAGMA, "no-cache");
    response.setHeader(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION);
    if (status == HttpServletResponse.SC_UNAUTHORIZED) {
      response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
    }
    objectMapper.writeValue(
        response.getOutputStream(),
        Map.of("code", code, "message", message, "details", Map.of()));
  }
}
