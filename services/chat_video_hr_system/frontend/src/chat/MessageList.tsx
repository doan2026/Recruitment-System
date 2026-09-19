import React, { useEffect, useRef } from 'react';
import { Message } from '../api/chat';
import { useAuth } from '../auth/AuthProvider';

interface MessageListProps {
  messages: Message[];
  loading?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, loading }) => {
  const { user } = useAuth();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Đang tải tin nhắn...</div>;
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Chưa có tin nhắn nào trong hội thoại này. Hãy gửi lời chào đầu tiên!
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => {
        const isSelf = msg.sender_id === user?.id;
        const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return (
          <div key={msg.id} className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
                isSelf
                  ? 'bg-indigo-600 text-white rounded-tr-none'
                  : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700/60'
              }`}
            >
              <div className="break-words whitespace-pre-wrap">{msg.content}</div>
            </div>
            <span className="text-[10px] text-slate-500 mt-1 px-1">{timeStr}</span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};
