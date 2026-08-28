package com.recruitment.interview.api;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(BusinessException.class)
    ResponseEntity<ApiError> handleBusiness(BusinessException exception) {
        return response(
            exception.status(),
            new ApiError(
                exception.code(),
                exception.getMessage(),
                exception.details()
            )
        );
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(
        MethodArgumentNotValidException exception
    ) {
        Map<String, Object> fields = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors().forEach(error ->
            fields.putIfAbsent(error.getField(), error.getDefaultMessage())
        );
        return response(
            HttpStatus.BAD_REQUEST,
            new ApiError(
                "VALIDATION_ERROR",
                "Request validation failed",
                fields
            )
        );
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadable(
        HttpMessageNotReadableException exception
    ) {
        return response(
            HttpStatus.BAD_REQUEST,
            new ApiError(
                "VALIDATION_ERROR",
                "Request body has an invalid format",
                null
            )
        );
    }

    @ExceptionHandler({
        MissingServletRequestParameterException.class,
        MethodArgumentTypeMismatchException.class,
        HandlerMethodValidationException.class
    })
    ResponseEntity<ApiError> handleRequestFormat(Exception exception) {
        return response(
            HttpStatus.BAD_REQUEST,
            new ApiError(
                "VALIDATION_ERROR",
                "Request validation failed",
                null
            )
        );
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<ApiError> handleStorage(DataAccessException exception) {
        return response(
            HttpStatus.SERVICE_UNAVAILABLE,
            new ApiError(
                "INTERVIEW_STORAGE_UNAVAILABLE",
                "Interview storage is temporarily unavailable",
                null
            )
        );
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiError> handleDenied(AccessDeniedException exception) {
        return response(
            HttpStatus.FORBIDDEN,
            new ApiError("ACCESS_DENIED", "Access is denied", null)
        );
    }

    private ResponseEntity<ApiError> response(
        HttpStatus status,
        ApiError error
    ) {
        return ResponseEntity.status(status)
            .cacheControl(CacheControl.noStore().cachePrivate())
            .header(HttpHeaders.PRAGMA, "no-cache")
            .header(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION)
            .body(error);
    }
}
