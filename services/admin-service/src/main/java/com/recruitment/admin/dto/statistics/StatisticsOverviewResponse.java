package com.recruitment.admin.dto.statistics;

import java.util.List;
import java.util.Map;

public record StatisticsOverviewResponse(List<DailyStatisticResponse> daily,
    Map<String, Long> totals, List<String> unavailableMetrics) {}
