import { ApiClientError, assertCanonicalUuidV4 } from "./apiClientCore";

export function assertChatResponseSession(expectedSessionId: string, actualSessionId: string): string {
  const expected = assertCanonicalUuidV4(expectedSessionId, "session_id");
  const actual = assertCanonicalUuidV4(actualSessionId, "session_id");
  if (actual !== expected) throw new ApiClientError({ code: "CHAT_SESSION_MISMATCH" });
  return actual;
}
