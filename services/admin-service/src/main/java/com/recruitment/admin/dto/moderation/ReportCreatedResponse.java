package com.recruitment.admin.dto.moderation;

import java.util.UUID;

public record ReportCreatedResponse(UUID id, String status, int version) {}
