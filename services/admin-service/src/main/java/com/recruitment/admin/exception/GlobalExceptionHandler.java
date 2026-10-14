package com.recruitment.admin.exception;

import com.recruitment.admin.dto.common.ApiError;
import jakarta.validation.ConstraintViolationException;
import java.util.Map;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class GlobalExceptionHandler {
  @ExceptionHandler(AdminFailure.class)
  ResponseEntity<ApiError> business(AdminFailure error) {
    return response(error.status(), error.code());
  }

  @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class,
      MethodArgumentTypeMismatchException.class, ConstraintViolationException.class, IllegalArgumentException.class})
  ResponseEntity<ApiError> invalid(Exception error) {
    return response(400, "VALIDATION_ERROR");
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<ApiError> unavailable(Exception error) {
    LoggerFactory.getLogger(GlobalExceptionHandler.class).error("Admin request failed: {}", error.getClass().getSimpleName());
    return response(503, "ADMIN_UNAVAILABLE");
  }

  private ResponseEntity<ApiError> response(int status, String code) {
    return ResponseEntity.status(status).body(new ApiError(code, code, Map.of()));
  }
}
