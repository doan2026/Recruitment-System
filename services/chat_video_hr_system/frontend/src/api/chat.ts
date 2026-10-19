import { apiFetch } from './client';

export interface Conversation {
  id: string;
  title: string;
  is_group: boolean;
  members?: string[];
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_message_id: string;
  content: string;
  created_at: string;
}

export const chatApi = {
  async listConversations(): Promise<Conversation[]> {
    return apiFetch<Conversation[]>('/chat/chats');
  },

  async getConversation(id: string): Promise<Conversation> {
    return apiFetch<Conversation>(`/chat/chats/${id}`);
  },

  async createConversation(title: string, memberIds: string[], isGroup: boolean = false): Promise<Conversation> {
    return apiFetch<Conversation>('/chat/chats', {
      method: 'POST',
      body: JSON.stringify({
        title,
        member_ids: memberIds,
        is_group: isGroup,
      }),
    });
  },

  async listMessages(conversationId: string, limit: number = 50, cursor?: string): Promise<Message[]> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (cursor) params.set('cursor', cursor);
    return apiFetch<Message[]>(`/chat/chats/${conversationId}/messages?${params.toString()}`);
  },

  async sendMessage(conversationId: string, content: string, clientMessageId?: string): Promise<Message> {
    return apiFetch<Message>(`/chat/chats/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        client_message_id: clientMessageId || crypto.randomUUID(),
      }),
    });
  },
};
