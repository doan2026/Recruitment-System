package com.recruitment.admin.model;

import java.time.LocalDate;

public record DailyStatistic(LocalDate date, String metric, long value) {}
