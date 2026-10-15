package com.recruitment.auth.config;

import com.recruitment.auth.config.properties.GoogleOAuthProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(GoogleOAuthProperties.class)
public class GoogleOAuthConfiguration {

  @Bean
  @ConditionalOnProperty(prefix = "auth.google", name = "enabled", havingValue = "true")
  @ConditionalOnMissingBean(ClientRegistrationRepository.class)
  ClientRegistrationRepository googleClientRegistrationRepository(
      GoogleOAuthProperties properties) {
    properties.validateEnabledConfiguration();
    ClientRegistration google = CommonOAuth2Provider.GOOGLE.getBuilder("google")
        .clientId(properties.clientId().trim())
        .clientSecret(properties.clientSecret().trim())
        .redirectUri(properties.redirectUri().trim())
        .scope("openid", "profile", "email")
        .build();
    return new InMemoryClientRegistrationRepository(google);
  }
}
