import { apiFetch } from './client';

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  metadata: any;
  is_read: boolean;
  created_at: string;
}

export const notificationApi = {
  async listNotifications(limit: number = 50, offset: number = 0): Promise<AppNotification[]> {
    return apiFetch<AppNotification[]>(`/notifications?limit=${limit}&offset=${offset}`);
  },

  async getUnreadCount(): Promise<{ unread_count: number }> {
    return apiFetch<{ unread_count: number }>('/notifications/unread-count');
  },

  async markRead(notificationId: string): Promise<void> {
    return apiFetch<void>(`/notifications/${notificationId}/read`, {
      method: 'PATCH',
    });
  },
};
