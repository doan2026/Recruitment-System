import { ApiClientError, assertCanonicalUuidV4 } from "./apiClientCore";

const inFlightSessions = new Set<string>();

export function isAiChatSessionBusy(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
    && error.status === 409
    && error.code === "CHAT_SESSION_BUSY";
}

export async function withAiChatSessionLock<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const canonicalSessionId = assertCanonicalUuidV4(sessionId, "session_id");
  if (inFlightSessions.has(canonicalSessionId)) {
    throw new ApiClientError({ code: "CHAT_SESSION_BUSY", status: 409 });
  }

  inFlightSessions.add(canonicalSessionId);
  try {
    return await operation();
  } finally {
    inFlightSessions.delete(canonicalSessionId);
  }
}
