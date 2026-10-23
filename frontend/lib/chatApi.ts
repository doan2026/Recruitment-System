import { API_PATHS, type ApiEnvelope, requestApi } from "./apiClient";

export interface ChatConversation {
  id: string;
  title: string;
  is_group: boolean;
  created_at: string;
  updated_at: string;
  last_message_at?: string;
  members?: string[];
  unread_count?: number;
  avatar_url?: string;
  counterpart?: {
    user_id: string;
    kind: "COMPANY" | "CANDIDATE";
    display_name: string;
    avatar_url?: string;
    company_id?: string;
  };
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

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  client_message_id?: string;
}

export function mergeConversationMessages(conversationId: string, current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const message of [...current, ...incoming]) {
    if (message.conversation_id !== conversationId) continue;
    const index = merged.findIndex(existing => existing.id === message.id ||
      (!!message.client_message_id && existing.client_message_id === message.client_message_id));
    if (index === -1) merged.push(message);
    else merged[index] = message;
  }
  return merged.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
}

export function listChatMessages(conversationId: string, cursor?: string, signal?: AbortSignal) {
  return requestApi<ChatMessage[]>(`${API_PATHS.chats}/${encodeURIComponent(conversationId)}/messages`, {
    privateData: true, signal, query: { limit: 20, cursor },
  });
}

export function sendChatMessage(conversationId: string, content: string, clientMessageId: string) {
  return requestApi<ChatMessage>(`${API_PATHS.chats}/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST", privateData: true, maxRetries: 0,
    body: { content, client_message_id: clientMessageId },
  });
}

export function parseCallMessage(content: string): { action: "STARTED" | "ACCEPTED" | "REJECTED" | "ENDED"; callId: string } | null {
  const match = /^\[CALL_(STARTED|ACCEPTED|REJECTED|ENDED)\] ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(content);
  return match ? { action: match[1].toUpperCase() as "STARTED" | "ACCEPTED" | "REJECTED" | "ENDED", callId: match[2].toLowerCase() } : null;
}
