package com.recruitment.admin.model;

import java.util.List;

public record PageResult<T>(List<T> items, long total, int page, int limit) {
  public PageResult {
    items = List.copyOf(items);
  }
}
