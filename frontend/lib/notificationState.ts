import { portalSection } from "./portalRoutes";

export interface InboxNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export function mergeNotifications(current: InboxNotification[], incoming: InboxNotification[]): InboxNotification[] {
  const merged = new Map(current.map(notification => [notification.id, notification]));
  for (const notification of incoming) merged.set(notification.id, notification);
  return [...merged.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
}

export function notificationDestination(notification: InboxNotification, role: string): string | null {
  const metadata = notification.metadata;
  const conversationId = metadata?.conversation_id;
  if (typeof conversationId === "string" && conversationId && (role === "CANDIDATE" || role === "RECRUITER")) return `${portalSection(role, "messages")}?chat=${encodeURIComponent(conversationId)}`;
  if (notification.type.toLowerCase().includes("interview") && role === "CANDIDATE") return "/candidate/interviews";
  const applicationId = metadata?.application_id;
  if (typeof applicationId === "string" && applicationId && ["CANDIDATE", "RECRUITER"].includes(role)) {
    return `/${role.toLowerCase()}/applications/${encodeURIComponent(applicationId)}`;
  }
  return null;
}
