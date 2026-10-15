package com.recruitment.admin.dto.statistics;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.recruitment.admin.model.DailyStatistic;
import java.sql.Date;

public record DailyStatisticResponse(@JsonProperty("stat_date") Date date, String metric, long value) {
  public static DailyStatisticResponse from(DailyStatistic statistic) {
    return new DailyStatisticResponse(Date.valueOf(statistic.date()), statistic.metric(), statistic.value());
  }
}
