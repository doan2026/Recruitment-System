package com.recruitment.application.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Optional;
import java.util.Set;
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
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    private static final Set<String> SYSTEM_ROLES = Set.of(
        "CANDIDATE",
        "RECRUITER",
        "ADMIN"
    );

    @Bean
    StrictBearerTokenResolver strictBearerTokenResolver() {
        return new StrictBearerTokenResolver();
    }

    @Bean
    SecurityAuthenticationEntryPoint securityAuthenticationEntryPoint(
        ObjectMapper objectMapper
    ) {
        return new SecurityAuthenticationEntryPoint(objectMapper);
    }

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
    InternalInterviewAuthenticationFilter internalInterviewAuthenticationFilter(
        @Value("${internal.interview-api-key}")
            String internalInterviewApiKey,
        @Value("${internal.profile-api-key}") String internalProfileApiKey,
        @Value("${clients.profile-internal-api-key}")
            String profileInternalApiKey,
        @Value("${clients.internal-api-key:}") String sharedInternalApiKey,
        JwtDecoder jwtDecoder,
        StrictBearerTokenResolver bearerTokenResolver
    ) {
        for (String otherKey : List.of(
            internalProfileApiKey,
            profileInternalApiKey,
            sharedInternalApiKey == null ? "" : sharedInternalApiKey
        )) {
            if (!otherKey.isBlank() && sameSecret(
                internalInterviewApiKey,
                otherKey
            )) {
                throw new IllegalStateException(
                    "Interview internal API key must be distinct from all " +
                    "other directional internal API keys"
                );
            }
        }
        return new InternalInterviewAuthenticationFilter(
            internalInterviewApiKey,
            jwtDecoder,
            bearerTokenResolver
        );
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
    InternalMetricsAuthenticationFilter internalMetricsAuthenticationFilter(
        @Value("${internal.metrics-api-key}") String metricsApiKey,
        @Value("${internal.profile-api-key}") String internalProfileApiKey,
        @Value("${internal.interview-api-key}")
            String internalInterviewApiKey
    ) {
        if (
            sameSecret(metricsApiKey, internalProfileApiKey)
            || sameSecret(metricsApiKey, internalInterviewApiKey)
        ) {
            throw new IllegalStateException(
                "INTERNAL_API_KEY_METRICS must differ from the other "
                    + "internal keys"
            );
        }
        return new InternalMetricsAuthenticationFilter(metricsApiKey);
    }

    @Bean
    FilterRegistrationBean<InternalMetricsAuthenticationFilter>
        disableMetricsContainerRegistration(
            InternalMetricsAuthenticationFilter filter
        ) {
        FilterRegistrationBean<InternalMetricsAuthenticationFilter>
            registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    @Order(0)
    SecurityFilterChain metricsSecurityFilterChain(
        HttpSecurity http,
        InternalMetricsAuthenticationFilter filter
    ) throws Exception {
        return http
            .securityMatcher("/actuator/prometheus")
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(
                SessionCreationPolicy.STATELESS
            ))
            .authorizeHttpRequests(auth -> auth
                .anyRequest().hasAuthority("ROLE_INTERNAL_METRICS")
            )
            .addFilterBefore(filter, BearerTokenAuthenticationFilter.class)
            .build();
    }

    @Bean
    FilterRegistrationBean<InternalInterviewAuthenticationFilter>
        disableInterviewContainerRegistration(
            InternalInterviewAuthenticationFilter filter
        ) {
        FilterRegistrationBean<InternalInterviewAuthenticationFilter>
            registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    @Order(1)
    SecurityFilterChain internalInterviewSecurityFilterChain(
        HttpSecurity http,
        InternalInterviewAuthenticationFilter filter
    ) throws Exception {
        return http
            .securityMatcher("/internal/v1/interview-scheduling/**")
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(
                SessionCreationPolicy.STATELESS
            ))
            .authorizeHttpRequests(auth -> auth
                .anyRequest().hasAuthority("ROLE_INTERNAL_INTERVIEW")
            )
            .addFilterBefore(filter, BearerTokenAuthenticationFilter.class)
            .build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain internalProfileSecurityFilterChain(
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
    @Order(3)
    SecurityFilterChain securityFilterChain(
        HttpSecurity http,
        StrictBearerTokenResolver bearerTokenResolver,
        SecurityAuthenticationEntryPoint authenticationEntryPoint
    ) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(
                SessionCreationPolicy.STATELESS
            ))
            .exceptionHandling(exceptions -> exceptions
                .authenticationEntryPoint(authenticationEntryPoint)
            )
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
            .oauth2ResourceServer(oauth -> oauth
                .bearerTokenResolver(bearerTokenResolver)
                .authenticationEntryPoint(authenticationEntryPoint)
                .jwt(jwt -> jwt.jwtAuthenticationConverter(
                    jwtAuthenticationConverter()
                ))
            )
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
            List<GrantedAuthority> authorities =
                roleClaim instanceof String role && SYSTEM_ROLES.contains(role)
                ? List.of(new SimpleGrantedAuthority("ROLE_" + role))
                : List.of();
            return new JwtAuthenticationToken(
                jwt,
                authorities,
                Optional.ofNullable(jwt.getSubject()).orElse("")
            );
        };
    }
}
