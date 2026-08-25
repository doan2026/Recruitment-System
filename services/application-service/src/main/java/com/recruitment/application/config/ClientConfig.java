package com.recruitment.application.config;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.boot.web.client.RestClientCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;

@Configuration
public class ClientConfig {
    @Bean
    RestClientCustomizer restClientTimeoutCustomizer() {
        return builder -> {
            HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(1))
                .build();
            JdkClientHttpRequestFactory factory =
                new JdkClientHttpRequestFactory(httpClient);
            factory.setReadTimeout(Duration.ofSeconds(3));
            builder.requestFactory(factory);
        };
    }
}
