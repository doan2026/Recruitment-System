import { ApiClientError } from "./apiClientCore";

export type AiChatFeatureState = "hidden" | "forbidden" | "reauthenticate" | null;

export function classifyAiChatFeatureState(error: unknown): AiChatFeatureState {
  if (!(error instanceof ApiClientError)) return null;
  if (error.status === 503 && error.code === "CHAT_NOT_CONFIGURED") return "hidden";
  if (error.status === 403 && error.code === "CHAT_ACCESS_FORBIDDEN") return "forbidden";
  if (error.status === 401) return "reauthenticate";
  return null;
}
