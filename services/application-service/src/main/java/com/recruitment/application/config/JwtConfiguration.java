package com.recruitment.application.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jwt.JwtDecoder;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(JwtVerificationProperties.class)
public class JwtConfiguration {
    @Bean
    JwtDecoder jwtDecoder(JwtVerificationProperties properties) {
        return new CanonicalJwtDecoder(properties);
    }
}
