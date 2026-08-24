package com.recruitment.application.config;

import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
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
