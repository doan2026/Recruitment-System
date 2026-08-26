package com.recruitment.auth.token;

import com.recruitment.auth.api.AuthBusinessException;

record TokenTransactionResult<T>(T value, AuthBusinessException failure) {
  static <T> TokenTransactionResult<T> success(T value) {
    return new TokenTransactionResult<>(value, null);
  }

  static <T> TokenTransactionResult<T> failure(AuthBusinessException failure) {
    return new TokenTransactionResult<>(null, failure);
  }

  T valueOrThrow() {
    if (failure != null) {
      throw failure;
    }
    return value;
  }
}
