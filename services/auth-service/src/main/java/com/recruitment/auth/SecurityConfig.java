package com.recruitment.auth;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
class SecurityConfig {
  @Bean
  SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    return http
        .csrf(csrf -> csrf.disable())
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
                HttpMethod.POST,
                "/auth/register",
                "/auth/otp/verify",
                "/auth/otp/resend").permitAll()
            .anyRequest().denyAll())
        .build();
  }
}
