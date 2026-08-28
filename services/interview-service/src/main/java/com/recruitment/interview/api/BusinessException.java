package com.recruitment.interview.api;

import java.util.Map;
import org.springframework.http.HttpStatus;

public class BusinessException extends RuntimeException {
    private final String code;
    private final HttpStatus status;
    private final Map<String, Object> details;

    public BusinessException(
        String code,
        String message,
        HttpStatus status
    ) {
        this(code, message, status, null);
    }

    public BusinessException(
        String code,
        String message,
        HttpStatus status,
        Map<String, Object> details
    ) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
    }

    public String code() { return code; }
    public HttpStatus status() { return status; }
    public Map<String, Object> details() { return details; }
}
