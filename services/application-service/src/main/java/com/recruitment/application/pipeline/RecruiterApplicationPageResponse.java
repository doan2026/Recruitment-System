package com.recruitment.application.pipeline;

import java.util.List;

public record RecruiterApplicationPageResponse(
    List<RecruiterApplicationItemResponse> items,
    int page,
    int size,
    long totalElements,
    int totalPages
) {}
