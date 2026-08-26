package com.recruitment.auth.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public final class SensitiveAuthResponseHeadersFilter extends OncePerRequestFilter {
  private static final Set<String> SENSITIVE_PATHS = Set.of(
      "/auth/otp/verify",
      "/auth/refresh",
      "/auth/logout",
      "/auth/google/exchange",
      "/auth/me");

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String path = request.getRequestURI().substring(request.getContextPath().length());
    return !SENSITIVE_PATHS.contains(path);
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request,
      HttpServletResponse response,
      FilterChain filterChain) throws ServletException, IOException {
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store, no-cache");
    response.setHeader(HttpHeaders.PRAGMA, "no-cache");
    response.setHeader(HttpHeaders.EXPIRES, "0");
    filterChain.doFilter(request, response);
  }
}
