import { ApiClientError } from "./apiClientCore";

const MAX_LOCAL_BACKOFF_SECONDS = 30;
const MAX_AUTOMATIC_RETRIES = 1;

export interface TransientRecoveryPlan {
  source: "retry-after" | "local-backoff";
  delaySeconds: number;
  automatic: boolean;
  status: 429 | 503;
}

export function isTransientApiError(
  error: unknown,
): error is ApiClientError & { readonly status: 429 | 503 } {
  return error instanceof ApiClientError && (error.status === 429 || error.status === 503);
}

export function createTransientRecoveryPlan(
  error: unknown,
  failureCount = 1,
): TransientRecoveryPlan | null {
  if (!isTransientApiError(error)) return null;

  const safeFailureCount = Math.max(1, Math.floor(failureCount));
  if (error.retryAfterSeconds !== null) {
    return {
      source: "retry-after",
      delaySeconds: error.retryAfterSeconds,
      automatic: safeFailureCount <= MAX_AUTOMATIC_RETRIES,
      status: error.status,
    };
  }

  return {
    source: "local-backoff",
    delaySeconds: Math.min(2 ** safeFailureCount, MAX_LOCAL_BACKOFF_SECONDS),
    automatic: false,
    status: error.status,
  };
}
