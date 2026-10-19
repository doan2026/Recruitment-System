import React, { useState } from 'react';
import { Conversation, Message } from '../api/chat';
import { MessageList } from './MessageList';
import { Video, Send, Users, Shield } from 'lucide-react';

interface ChatWindowProps {
  conversation: Conversation | null;
  messages: Message[];
  loadingMessages: boolean;
  onSendMessage: (content: string) => void;
  onStartVideoCall?: () => void;
  isWsConnected: boolean;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation,
  messages,
  loadingMessages,
  onSendMessage,
  onStartVideoCall,
  isWsConnected,
}) => {
  const [inputContent, setInputContent] = useState('');

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 text-slate-500">
        <Users className="w-12 h-12 mb-3 opacity-30 text-indigo-400" />
        <p className="text-sm">Chọn một hội thoại bên trái để bắt đầu chat hoặc phỏng vấn</p>
      </div>
    );
  }

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputContent.trim()) return;
    onSendMessage(inputContent.trim());
    setInputContent('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950">
      {/* Chat header */}
      <div className="h-16 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/40 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center font-bold">
            {conversation.title ? conversation.title.charAt(0).toUpperCase() : 'C'}
          </div>
          <div>
            <h3 className="font-bold text-white text-sm tracking-wide">{conversation.title}</h3>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className={`w-2 h-2 rounded-full ${isWsConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span>{isWsConnected ? 'Realtime Connected' : 'Connecting...'}</span>
            </div>
          </div>
        </div>

        {/* Video Call Trigger */}
        <div className="flex items-center gap-3">
          <button
            onClick={onStartVideoCall}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-sm font-semibold shadow-lg shadow-indigo-600/20 transition"
          >
            <Video className="w-4 h-4" />
            <span>Phòng Video Call</span>
          </button>
        </div>
      </div>

      {/* Message List */}
      <MessageList messages={messages} loading={loadingMessages} />

      {/* Message Input bar */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/40">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            type="text"
            value={inputContent}
            onChange={(e) => setInputContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nhập tin nhắn..."
            className="flex-1 px-4 py-3 bg-slate-900/90 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
          />
          <button
            type="submit"
            disabled={!inputContent.trim()}
            className="p-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white disabled:opacity-40 transition shadow-md shadow-indigo-600/20"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
};
