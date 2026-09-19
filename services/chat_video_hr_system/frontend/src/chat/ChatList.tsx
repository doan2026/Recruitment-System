import React, { useEffect, useState } from 'react';
import { Conversation, chatApi } from '../api/chat';
import { authApi, User } from '../api/auth';
import { useAuth } from '../auth/AuthProvider';
import { MessageSquarePlus, Users, User as UserIcon, X, Search, Check } from 'lucide-react';

interface ChatListProps {
  selectedConvId: string | null;
  onSelectConv: (conv: Conversation) => void;
  onStartVideoCall?: (conv: Conversation) => void;
}

export const ChatList: React.FC<ChatListProps> = ({ selectedConvId, onSelectConv }) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchConversations = async () => {
    try {
      const data = await chatApi.listConversations();
      setConversations(data || []);
      if (!selectedConvId && data && data.length > 0) {
        onSelectConv(data[0]);
      }
    } catch (err) {
      console.error('Failed to load conversations', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  const openNewChatModal = async () => {
    setShowModal(true);
    setSelectedUserIds([]);
    setGroupTitle('');
    try {
      const users = await authApi.listUsers();
      // Filter out self
      setAllUsers(users.filter(u => u.id !== user?.id));
    } catch (err) {
      console.error('Failed to load users', err);
    }
  };

  const toggleUserSelection = (id: string) => {
    if (selectedUserIds.includes(id)) {
      setSelectedUserIds(selectedUserIds.filter(uid => uid !== id));
    } else {
      setSelectedUserIds([...selectedUserIds, id]);
    }
  };

  const handleCreateConversation = async () => {
    if (selectedUserIds.length === 0) return;
    setCreating(true);
    try {
      const isGroup = selectedUserIds.length > 1;
      const title = groupTitle || (isGroup ? 'Nhóm phỏng vấn mới' : 'Hội thoại trực tiếp');
      const conv = await chatApi.createConversation(title, selectedUserIds, isGroup);
      setConversations([conv, ...conversations]);
      onSelectConv(conv);
      setShowModal(false);
    } catch (err) {
      console.error('Failed to create conversation', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-white tracking-wide flex items-center gap-2">
            <span>Hội thoại</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold">
              {conversations.length}
            </span>
          </h2>
        </div>
        <button
          onClick={openNewChatModal}
          className="p-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-300 transition"
          title="Tạo hội thoại mới"
        >
          <MessageSquarePlus className="w-5 h-5" />
        </button>
      </div>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Đang tải danh sách...</div>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            Chưa có hội thoại nào.<br />Bấm nút trên để tạo mới.
          </div>
        ) : (
          conversations.map((conv) => {
            const isSelected = selectedConvId === conv.id;
            return (
              <button
                key={conv.id}
                onClick={() => onSelectConv(conv)}
                className={`w-full text-left p-3 rounded-xl transition flex items-center gap-3 ${
                  isSelected
                    ? 'bg-indigo-600/20 border border-indigo-500/30 text-white'
                    : 'hover:bg-slate-800/50 text-slate-300'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  conv.is_group ? 'bg-purple-600/20 text-purple-400' : 'bg-indigo-600/20 text-indigo-400'
                }`}>
                  {conv.is_group ? <Users className="w-5 h-5" /> : <UserIcon className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{conv.title || 'Hội thoại'}</div>
                  <div className="text-xs text-slate-400 truncate">
                    {conv.is_group ? 'Nhóm phỏng vấn' : 'Trực tiếp 1-1'}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* New Conversation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Tạo cuộc hội thoại mới</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-400 mb-1">Tiêu đề hội thoại</label>
              <input
                type="text"
                placeholder="VD: Phỏng vấn vị trí Backend Go..."
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-400 mb-2">Chọn thành viên tham gia</label>
              <div className="max-h-56 overflow-y-auto space-y-1 bg-slate-950/60 p-2 rounded-xl border border-slate-800/80">
                {allUsers.length === 0 ? (
                  <p className="text-center text-slate-500 text-xs py-4">Chưa có người dùng nào khác trong hệ thống.</p>
                ) : (
                  allUsers.map((u) => {
                    const selected = selectedUserIds.includes(u.id);
                    return (
                      <div
                        key={u.id}
                        onClick={() => toggleUserSelection(u.id)}
                        className={`p-2 rounded-lg cursor-pointer flex items-center justify-between text-sm transition ${
                          selected ? 'bg-indigo-600/30 text-white font-medium' : 'hover:bg-slate-800/40 text-slate-300'
                        }`}
                      >
                        <div>
                          <div>{u.full_name}</div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                        </div>
                        {selected && <Check className="w-4 h-4 text-indigo-400" />}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateConversation}
                disabled={selectedUserIds.length === 0 || creating}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition"
              >
                {creating ? 'Đang tạo...' : 'Bắt đầu chat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
