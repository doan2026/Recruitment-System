package com.recruitment.admin;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.client.*;

@Component
class ServiceGateway {

  private final RestClient http;
  private final Map<String, String> bases;

  ServiceGateway(
    @Value("${admin.auth-url}") String auth,
    @Value("${admin.company-url}") String company,
    @Value("${admin.job-url}") String job
  ) {
    var factory = new JdkClientHttpRequestFactory(
      HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(3))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build()
    );
    factory.setReadTimeout(Duration.ofSeconds(8));
    http = RestClient.builder().requestFactory(factory).build();
    bases = Map.of(
      "AUTH",
      origin(auth),
      "COMPANY",
      origin(company),
      "JOB",
      origin(job)
    );
  }

  private static String origin(String value) {
    URI uri = URI.create(value);
    if (
      !Set.of("http", "https").contains(uri.getScheme()) ||
      uri.getHost() == null ||
      uri.getUserInfo() != null ||
      uri.getQuery() != null ||
      uri.getFragment() != null
    ) throw new IllegalArgumentException("Invalid service URL");
    return value.replaceAll("/+$", "");
  }

  JsonNode call(
    String service,
    HttpMethod method,
    String path,
    Object body,
    Jwt jwt
  ) {
    try {
      var req = http
        .method(method)
        .uri(URI.create(bases.get(service) + path))
        .headers(h -> h.setBearerAuth(jwt.getTokenValue()));
      if (body != null) req.contentType(MediaType.APPLICATION_JSON).body(body);
      var result = req.retrieve().body(JsonNode.class);
      if (result == null || !result.has("data")) throw new AdminFailure(
        502,
        "UPSTREAM_RESPONSE_INVALID"
      );
      return result;
    } catch (HttpClientErrorException e) {
      throw new AdminFailure(e.getStatusCode().value(), "UPSTREAM_REJECTED");
    } catch (RestClientException e) {
      throw new AdminFailure(503, "UPSTREAM_UNAVAILABLE");
    }
  }

  void requireCurrentAdmin(Jwt jwt) {
    JsonNode current = call("AUTH", HttpMethod.GET, "/auth/me", null, jwt).path(
      "data"
    );
    if (
      !jwt.getSubject().equals(current.path("id").asText()) ||
      !"ADMIN".equals(current.path("role").asText())
    ) throw new AdminFailure(403, "ACCESS_DENIED");
  }
}
