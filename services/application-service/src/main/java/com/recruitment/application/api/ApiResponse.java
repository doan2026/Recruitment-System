package com.recruitment.application.api;

import java.util.Map;

public record ApiResponse<T>(T data, Map<String, Object> meta) {
    public static <T> ApiResponse<T> of(T data) {
        return new ApiResponse<>(data, null);
    }
}
