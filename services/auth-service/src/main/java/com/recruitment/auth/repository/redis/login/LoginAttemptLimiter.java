package com.recruitment.auth.repository.redis.login;

import java.time.Duration;

public interface LoginAttemptLimiter {
  AttemptDecision preflight(String normalizedEmail);

  AttemptDecision recordFailure(String normalizedEmail);

  AttemptDecision completeSuccessfulCredential(String normalizedEmail);

  void clearAfterPasswordReset(String normalizedEmail);

  record AttemptDecision(State state, int failedAttempts, Duration retryAfter) {
    public AttemptDecision {
      if (state == null) {
        throw new IllegalArgumentException("state is required");
      }
      if (failedAttempts < 0) {
        throw new IllegalArgumentException("failedAttempts cannot be negative");
      }
      if (retryAfter == null || retryAfter.isNegative()) {
        throw new IllegalArgumentException("retryAfter cannot be null or negative");
      }
      if (state == State.BLOCKED && retryAfter.isZero()) {
        throw new IllegalArgumentException("a blocked decision requires a retry delay");
      }
      if (state != State.BLOCKED && !retryAfter.isZero()) {
        throw new IllegalArgumentException("only a blocked decision may have a retry delay");
      }
    }

    public static AttemptDecision allowed(int failedAttempts) {
      return new AttemptDecision(State.ALLOWED, failedAttempts, Duration.ZERO);
    }

    public static AttemptDecision failed(int failedAttempts) {
      return new AttemptDecision(State.FAILED, failedAttempts, Duration.ZERO);
    }

    public static AttemptDecision blocked(int failedAttempts, Duration retryAfter) {
      return new AttemptDecision(State.BLOCKED, failedAttempts, retryAfter);
    }

    public boolean blocked() {
      return state == State.BLOCKED;
    }
  }

  enum State {
    ALLOWED,
    FAILED,
    BLOCKED
  }
}
