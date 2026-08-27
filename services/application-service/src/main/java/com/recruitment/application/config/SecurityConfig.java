package com.recruitment.application.config;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.core.convert.converter.Converter;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    @Bean
    InternalProfileAuthenticationFilter internalProfileAuthenticationFilter(
        @Value("${internal.profile-api-key}") String internalProfileApiKey,
        @Value("${clients.profile-internal-api-key}")
            String profileInternalApiKey
    ) {
        if (sameSecret(internalProfileApiKey, profileInternalApiKey)) {
            throw new IllegalStateException(
                "Profile directional internal API keys must be distinct"
            );
        }
        return new InternalProfileAuthenticationFilter(internalProfileApiKey);
    }

    @Bean
    FilterRegistrationBean<InternalProfileAuthenticationFilter>
        disableContainerRegistration(
            InternalProfileAuthenticationFilter filter
        ) {
        FilterRegistrationBean<InternalProfileAuthenticationFilter>
            registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    @Order(1)
    SecurityFilterChain internalSecurityFilterChain(
        HttpSecurity http,
        InternalProfileAuthenticationFilter internalProfileAuthenticationFilter
    ) throws Exception {
        return http
            .securityMatcher("/internal/**")
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(
                SessionCreationPolicy.STATELESS
            ))
            .authorizeHttpRequests(auth -> auth
                .anyRequest().hasAuthority("ROLE_INTERNAL_PROFILE")
            )
            .addFilterBefore(
                internalProfileAuthenticationFilter,
                BearerTokenAuthenticationFilter.class
            )
            .build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(
                SessionCreationPolicy.STATELESS
            ))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(
                    "/actuator/health",
                    "/actuator/info",
                    "/docs/**",
                    "/swagger-ui/**",
                    "/v3/api-docs/**"
                ).permitAll()
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth -> oauth.jwt(jwt ->
                jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())
            ))
            .build();
    }

    private boolean sameSecret(String first, String second) {
        return MessageDigest.isEqual(sha256(first), sha256(second));
    }

    private byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(
                (value == null ? "" : value).getBytes(
                    StandardCharsets.UTF_8
                )
            );
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(
                "SHA-256 is unavailable",
                exception
            );
        }
    }

    private Converter<Jwt, JwtAuthenticationToken> jwtAuthenticationConverter() {
        return jwt -> {
            Object roleClaim = jwt.getClaim("role");
            List<GrantedAuthority> authorities;
            if (roleClaim instanceof String role) {
                authorities = List.of(new SimpleGrantedAuthority("ROLE_" + role));
            } else if (roleClaim instanceof List<?> roles) {
                authorities = roles.stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .map(role -> (GrantedAuthority)
                        new SimpleGrantedAuthority("ROLE_" + role))
                    .collect(Collectors.toList());
            } else {
                authorities = List.of();
            }
            return new JwtAuthenticationToken(
                jwt,
                authorities,
                Optional.ofNullable(jwt.getSubject()).orElse("")
            );
        };
    }
}
