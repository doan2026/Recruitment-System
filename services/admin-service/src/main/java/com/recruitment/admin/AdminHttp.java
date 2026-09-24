package com.recruitment.admin;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.*;
import org.slf4j.*;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.filter.OncePerRequestFilter;

class AdminFailure extends RuntimeException {

  final int status;
  final String code;

  AdminFailure(int status, String code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

@RestControllerAdvice
class AdminErrors {

  @ExceptionHandler(AdminFailure.class)
  ResponseEntity<?> business(AdminFailure e) {
    return response(e.status, e.code);
  }

  @ExceptionHandler(
    {
      org.springframework.web.bind.MethodArgumentNotValidException.class,
      org.springframework.http.converter.HttpMessageNotReadableException.class,
      org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
      jakarta.validation.ConstraintViolationException.class,
      IllegalArgumentException.class,
    }
  )
  ResponseEntity<?> invalid(Exception e) {
    return response(400, "VALIDATION_ERROR");
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<?> unavailable(Exception e) {
    LoggerFactory.getLogger(AdminErrors.class).error(
      "Admin request failed: {}",
      e.getClass().getSimpleName()
    );
    return response(503, "ADMIN_UNAVAILABLE");
  }

  private ResponseEntity<?> response(int status, String code) {
    return ResponseEntity.status(status).body(
      Map.of("code", code, "message", code, "details", Map.of())
    );
  }
}

@Component
@org.springframework.core.annotation.Order(
  org.springframework.core.Ordered.HIGHEST_PRECEDENCE + 20
)
class AdminRequestFilter extends OncePerRequestFilter {

  private final Logger log = LoggerFactory.getLogger(getClass());

  @Override
  protected void doFilterInternal(
    HttpServletRequest q,
    HttpServletResponse s,
    FilterChain c
  ) throws ServletException, IOException {
    String id = UUID.randomUUID().toString();
    s.setHeader("X-Request-ID", id);
    s.setHeader("Cache-Control", "private, no-store");
    s.setHeader("Pragma", "no-cache");
    s.setHeader("Vary", "Authorization");
    try (var ignored = MDC.putCloseable("requestId", id)) {
      try {
        c.doFilter(q, s);
      } finally {
        log.info(
          "request_id={} method={} status={}",
          id,
          q.getMethod(),
          s.getStatus()
        );
      }
    }
  }
}
