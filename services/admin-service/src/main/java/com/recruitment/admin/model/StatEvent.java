package com.recruitment.admin.model;

import java.time.Instant;
import java.util.UUID;

public record StatEvent(UUID id, UUID entity, String metric, Instant time) {}
