package com.recruitment.admin.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.recruitment.admin.infrastructure.client.ServiceGateway;
import org.springframework.http.HttpMethod;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class AdminQueryService {
  private final ServiceGateway gateway;

  public AdminQueryService(ServiceGateway gateway) {
    this.gateway = gateway;
  }

  public JsonNode pendingCompanies(Jwt actor, int page, int limit) {
    gateway.requireCurrentAdmin(actor);
    return gateway.call("COMPANY", HttpMethod.GET, "/?verified_status=PENDING&page=" + page + "&limit=" + limit, null, actor);
  }

  public JsonNode pendingJobs(Jwt actor) {
    gateway.requireCurrentAdmin(actor);
    return gateway.call("JOB", HttpMethod.GET, "/pending", null, actor);
  }

  public JsonNode users(Jwt actor, String email, String role, Boolean locked, int page, int limit) {
    gateway.requireCurrentAdmin(actor);
    var uri = UriComponentsBuilder.fromPath("/auth/users").queryParam("email", email)
        .queryParam("page", page).queryParam("limit", limit);
    if (role != null) uri.queryParam("role", role);
    if (locked != null) uri.queryParam("locked", locked);
    return gateway.call("AUTH", HttpMethod.GET, uri.build().encode().toUriString(), null, actor);
  }
}
