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
    public RestClientCustomizer restClientTimeoutCustomizer() {
        return builder -> {
            // The JDK client defaults to HTTP/2, which over cleartext sends an
            // h2c upgrade. AI Service runs on uvicorn, whose h11 parser refuses
            // that request, so every /match call would fail on the wire while
            // every mocked test still passed. Pin HTTP/1.1 for all downstreams.
            HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(1))
                .build();
            JdkClientHttpRequestFactory factory =
                new JdkClientHttpRequestFactory(httpClient);
            factory.setReadTimeout(Duration.ofSeconds(3));
            builder.requestFactory(factory);
        };
    }
}
