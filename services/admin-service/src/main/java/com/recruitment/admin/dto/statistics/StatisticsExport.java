package com.recruitment.admin.dto.statistics;

public record StatisticsExport(byte[] content, String filename, String contentType) {}
