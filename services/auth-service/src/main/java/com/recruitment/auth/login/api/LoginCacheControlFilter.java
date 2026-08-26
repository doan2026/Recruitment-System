package com.recruitment.auth.login.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public final class LoginCacheControlFilter extends OncePerRequestFilter {
  private static final String LOGIN_PATH = "/auth/login";

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !(request.getContextPath() + LOGIN_PATH).equals(request.getRequestURI());
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
