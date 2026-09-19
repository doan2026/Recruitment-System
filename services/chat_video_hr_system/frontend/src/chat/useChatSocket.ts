import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Message } from '../api/chat';

export const useChatSocket = (onNewMessage?: (msg: Message) => void) => {
  const { token, user } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimeoutRef = useRef<any>(null);

  const connect = useCallback(() => {
    if (!token || !user) return;

    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws/chat';
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      // Send first frame: {"type":"auth","token":"<JWT>"} within 5s
      ws.send(JSON.stringify({
        type: 'auth',
        token,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'auth_success') {
          setConnected(true);
        } else if (data.type === 'new_message' && data.message) {
          onNewMessage?.(data.message);
        }
      } catch (err) {
        console.error('WS Parse Error:', err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      socketRef.current = null;
      // Auto-reconnect after 3s if still authenticated
      reconnectTimeoutRef.current = setTimeout(() => {
        if (token) {
          connect();
        }
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error('WS Error:', err);
      ws.close();
    };
  }, [token, user, onNewMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback((conversationId: string, content: string, clientMessageId?: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }

    const payload = {
      type: 'chat_message',
      conversation_id: conversationId,
      client_message_id: clientMessageId || crypto.randomUUID(),
      content,
    };

    socketRef.current.send(JSON.stringify(payload));
    return true;
  }, []);

  return { connected, sendMessage };
};
