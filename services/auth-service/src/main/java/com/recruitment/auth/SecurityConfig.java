package com.recruitment.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.auth.api.ApiError;
import com.recruitment.auth.oauth.GoogleOAuthSecurityConfigurer;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AuthCorsProperties.class)
class SecurityConfig {
  @Bean
  SecurityFilterChain securityFilterChain(
      HttpSecurity http,
      ObjectMapper objectMapper,
      GoogleOAuthSecurityConfigurer googleOAuth,
      JwtAuthenticationConverter jwtAuthenticationConverter) throws Exception {
    http
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
                "/auth/health",
                "/actuator/health",
                "/actuator/health/**")
            .permitAll()
            .requestMatchers(
                HttpMethod.GET,
                "/auth/.well-known/jwks.json",
                "/auth/google",
                GoogleOAuthSecurityConfigurer.GOOGLE_AUTHORIZATION_URI,
                GoogleOAuthSecurityConfigurer.CALLBACK_URI)
            .permitAll()
            .requestMatchers(
                HttpMethod.POST,
                "/auth/register",
                "/auth/otp/verify",
                "/auth/otp/resend",
                "/auth/login",
                "/auth/forgot-password",
                "/auth/reset-password",
                "/auth/refresh",
                "/auth/logout",
                "/auth/google/exchange")
            .permitAll()
            .requestMatchers(HttpMethod.GET, "/auth/me").authenticated()
            .anyRequest().denyAll())
        .oauth2ResourceServer(oauth -> oauth
            .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter))
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
                    "Access is denied")));
    googleOAuth.configure(http);
    return http.build();
  }

  @Bean
  CorsConfigurationSource corsConfigurationSource(AuthCorsProperties properties) {
    CorsConfiguration configuration = new CorsConfiguration();
    configuration.setAllowedOrigins(properties.allowedOrigins());
    configuration.setAllowedMethods(List.of("GET", "HEAD", "POST", "OPTIONS"));
    configuration.setAllowedHeaders(List.of(
        HttpHeaders.AUTHORIZATION,
        HttpHeaders.CONTENT_TYPE,
        HttpHeaders.ACCEPT));
    configuration.setExposedHeaders(List.of(HttpHeaders.RETRY_AFTER));
    configuration.setAllowCredentials(true);
    configuration.setMaxAge(600L);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/auth/**", configuration);
    return source;
  }

  @Bean
  JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
    authorities.setAuthoritiesClaimName("role");
    authorities.setAuthorityPrefix("ROLE_");
    JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(authorities);
    return converter;
  }

  private static void writeSecurityError(
      ObjectMapper objectMapper,
      HttpServletResponse response,
      int status,
      String code,
      String message) throws IOException {
    response.setStatus(status);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    response.setHeader(HttpHeaders.PRAGMA, "no-cache");
    objectMapper.writeValue(
        response.getOutputStream(),
        new ApiError(code, message, Map.of()));
  }
}
