package com.recruitment.auth.exception;

import com.recruitment.auth.dto.common.ApiError;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class GlobalExceptionHandler {
  @ExceptionHandler(AuthBusinessException.class)
  ResponseEntity<ApiError> handleBusiness(AuthBusinessException exception) {
    HttpHeaders headers = new HttpHeaders();
    if (exception.retryAfterSeconds() != null) {
      headers.set(HttpHeaders.RETRY_AFTER, Long.toString(exception.retryAfterSeconds()));
    }
    return ResponseEntity.status(exception.status())
        .headers(headers)
        .body(new ApiError(exception.code(), exception.getMessage(), exception.details()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception) {
    Map<String, Object> fields = new LinkedHashMap<>();
    exception.getBindingResult().getFieldErrors().forEach(error ->
        fields.putIfAbsent(error.getField(), error.getDefaultMessage()));
    return ResponseEntity.badRequest().body(
        new ApiError("VALIDATION_ERROR", "Request validation failed", fields));
  }

  @ExceptionHandler({
      HttpMessageNotReadableException.class,
      MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<ApiError> handleInvalidRequest(Exception exception) {
    return ResponseEntity.badRequest().body(
        new ApiError(
            "VALIDATION_ERROR",
            "Request body or parameter has an invalid format",
            Map.of()));
  }
}
