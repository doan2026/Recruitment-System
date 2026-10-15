package com.recruitment.auth.config;

import com.recruitment.auth.config.properties.LoginProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(LoginProperties.class)
class LoginConfiguration {}
