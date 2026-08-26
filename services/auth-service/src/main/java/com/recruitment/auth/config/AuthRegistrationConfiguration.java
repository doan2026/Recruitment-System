package com.recruitment.auth.config;

import com.recruitment.auth.registration.otp.OtpProperties;
import java.security.SecureRandom;
import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
@EnableConfigurationProperties({AuthMailProperties.class, OtpProperties.class})
public class AuthRegistrationConfiguration {
  @Bean
  PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(10);
  }

  @Bean
  Clock clock() {
    return Clock.systemUTC();
  }

  @Bean
  SecureRandom secureRandom() {
    return new SecureRandom();
  }
}
