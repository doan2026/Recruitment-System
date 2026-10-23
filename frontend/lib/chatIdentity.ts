import type { ChatConversation } from "./chatApi";

export interface ChatIdentityView {
  name: string;
  imageUrl: string | null;
  description: string;
  kind: "COMPANY" | "CANDIDATE" | "GROUP" | "UNKNOWN";
}

function safeImage(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://careerhub.invalid");
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch { return null; }
}

export function conversationIdentity(conversation: ChatConversation, accountId: string): ChatIdentityView {
  if (conversation.is_group) return { name: conversation.title || "Nhóm trò chuyện", imageUrl: safeImage(conversation.avatar_url), description: "Nhóm trò chuyện", kind: "GROUP" };
  const peer = conversation.counterpart;
  if (peer && peer.user_id !== accountId && conversation.members?.includes(peer.user_id) && peer.display_name?.trim() && ["COMPANY", "CANDIDATE"].includes(peer.kind)) {
    return { name: peer.display_name.trim(), imageUrl: safeImage(peer.avatar_url), description: peer.kind === "COMPANY" ? "Công ty tuyển dụng" : "Ứng viên", kind: peer.kind };
  }
  const title = conversation.title?.replace(/^Chat với\s+/i, "").trim();
  const generic = !title || /^(Nhà tuyển dụng|Ứng viên|Đối tác)$/i.test(title);
  const peerId = conversation.members?.find(id => id !== accountId);
  return { name: generic ? "Cuộc trò chuyện" : title, imageUrl: safeImage(conversation.avatar_url), description: generic ? `Thông tin đang cập nhật${peerId ? ` · ${peerId.slice(0, 8)}` : ""}` : "Trao đổi tuyển dụng", kind: "UNKNOWN" };
}
