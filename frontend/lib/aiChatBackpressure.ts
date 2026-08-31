import { ApiClientError } from "./apiClientCore";

export type AiChatBackpressure =
  | { kind: "rate-limit"; retryAfterSeconds: number }
  | { kind: "busy"; retryAfterSeconds: number; delayMs: number }
  | { kind: "manual"; code: "CHAT_PROVIDER_UNAVAILABLE" | "CHAT_HISTORY_UNAVAILABLE" }
  | null;

export function classifyAiChatBackpressure(error: unknown): AiChatBackpressure {
  if (!(error instanceof ApiClientError)) return null;
  if (error.status === 429 && error.code === "CHAT_RATE_LIMITED") {
    return { kind: "rate-limit", retryAfterSeconds: Math.max(1, error.retryAfterSeconds ?? 1) };
  }
  if (error.status === 503 && error.code === "CHAT_BUSY" && error.retryAfterSeconds !== null) {
    const retryAfterSeconds = Math.max(1, error.retryAfterSeconds);
    return { kind: "busy", retryAfterSeconds, delayMs: Math.min(retryAfterSeconds * 1_000, 2_000) };
  }
  if (
    error.status === 503
    && (error.code === "CHAT_PROVIDER_UNAVAILABLE" || error.code === "CHAT_HISTORY_UNAVAILABLE")
    && error.retryAfterSeconds === null
  ) {
    return { kind: "manual", code: error.code };
  }
  return null;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runAiChatWithBusyRetry<T>(
  operation: () => Promise<T>,
  sleep: (delayMs: number) => Promise<void> = wait,
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    const policy = classifyAiChatBackpressure(error);
    if (policy?.kind !== "busy") throw error;
    await sleep(policy.delayMs);
    return operation();
  }
}
