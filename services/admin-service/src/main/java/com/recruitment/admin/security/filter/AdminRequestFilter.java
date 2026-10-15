package com.recruitment.admin.security.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class AdminRequestFilter extends OncePerRequestFilter {
  private final Logger log = LoggerFactory.getLogger(getClass());

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String id = UUID.randomUUID().toString();
    response.setHeader("X-Request-ID", id);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Vary", "Authorization");
    try (var ignored = MDC.putCloseable("requestId", id)) {
      try {
        chain.doFilter(request, response);
      } finally {
        log.info("request_id={} method={} status={}", id, request.getMethod(), response.getStatus());
      }
    }
  }
}
