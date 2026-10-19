import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { AppNotification, notificationApi } from '../api/notification';
import { API_BASE_URL } from '../api/client';

export const useNotificationSSE = () => {
  const { token, user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchInitialNotifications = useCallback(async () => {
    if (!token || !user) return;
    try {
      const [list, countRes] = await Promise.all([
        notificationApi.listNotifications(20),
        notificationApi.getUnreadCount(),
      ]);
      setNotifications(list || []);
      setUnreadCount(countRes?.unread_count || 0);
    } catch (err) {
      console.error('Failed to load initial notifications:', err);
    }
  }, [token, user]);

  useEffect(() => {
    fetchInitialNotifications();
  }, [fetchInitialNotifications]);

  useEffect(() => {
    if (!token || !user) return;

    const streamUrl = `${API_BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    es.addEventListener('notification', (event) => {
      try {
        const notif: AppNotification = JSON.parse(event.data);
        setNotifications((prev) => [notif, ...prev]);
        setUnreadCount((prev) => prev + 1);
      } catch (err) {
        console.error('Failed to parse SSE notification:', err);
      }
    });

    es.onerror = () => {
      // EventSource automatically retries on error
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [token, user]);

  const markRead = async (id: string) => {
    try {
      await notificationApi.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  return {
    notifications,
    unreadCount,
    markRead,
    refresh: fetchInitialNotifications,
  };
};
