package com.recruitment.admin.dto.common;

import java.util.Map;

public record ApiError(String code, String message, Map<String, Object> details) {}
