export type AiChatMessageRole = "user" | "assistant";

export interface AiChatMessage {
  id: string;
  role: AiChatMessageRole;
  content: string;
}

export const AI_CHAT_WELCOME_MESSAGE: AiChatMessage = Object.freeze({
  id: "welcome",
  role: "assistant",
  content: "Xin chào! Mình có thể hỗ trợ bạn về tìm việc và quy trình ứng tuyển.",
});

export function createAiChatConversation(): AiChatMessage[] {
  return [{ ...AI_CHAT_WELCOME_MESSAGE }];
}

export function appendAiChatExchange(
  messages: readonly AiChatMessage[],
  userMessage: string,
  answer: string,
  exchangeId: string,
): AiChatMessage[] {
  return [
    ...messages,
    { id: `${exchangeId}-user`, role: "user", content: userMessage },
    { id: `${exchangeId}-assistant`, role: "assistant", content: answer },
  ];
}
