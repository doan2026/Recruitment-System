import { API_PATHS, type ApiEnvelope, requestApi } from "./apiClient";

export interface ChatConversation {
  id: string;
  title: string;
  is_group: boolean;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  unread_count?: number;
  avatar_url?: string;
}

export async function createConversation(
  title: string,
  memberIds: string[],
  isGroup: boolean,
  signal?: AbortSignal,
): Promise<ApiEnvelope<ChatConversation>> {
  const response = await requestApi<ChatConversation>(API_PATHS.chats, {
    method: "POST",
    privateData: true,
    signal,
    body: {
      title,
      member_ids: memberIds,
      is_group: isGroup,
    },
    maxRetries: 0,
  });
  return response;
}
