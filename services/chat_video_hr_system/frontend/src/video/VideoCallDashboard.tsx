import React, { useEffect, useState } from 'react';
import { videoApi, VideoCall } from '../api/video';
import { Video, Plus, Users, Clock, ArrowRight, Radio } from 'lucide-react';

interface VideoCallDashboardProps {
  onJoinCall: (callId: string, roomName: string, title: string) => void;
}

export const VideoCallDashboard: React.FC<VideoCallDashboardProps> = ({ onJoinCall }) => {
  const [calls, setCalls] = useState<VideoCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchCalls = async () => {
    try {
      const data = await videoApi.listCalls();
      setCalls(data || []);
    } catch (err) {
      console.error('Failed to load video calls', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
    const interval = setInterval(fetchCalls, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const call = await videoApi.createCall(newTitle.trim());
      setCalls([call, ...calls]);
      setNewTitle('');
      onJoinCall(call.id, call.room_name, call.title);
    } catch (err) {
      console.error('Failed to create call', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Banner & Create Form */}
        <div className="p-8 rounded-3xl glass-panel relative overflow-hidden">
          <div className="max-w-xl relative z-10">
            <span className="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-4 inline-block">
              WebRTC Video Conference
            </span>
            <h2 className="text-2xl font-bold text-white mb-2">Bắt đầu phòng phỏng vấn trực tuyến</h2>
            <p className="text-slate-400 text-sm mb-6 leading-relaxed">
              Tạo phòng phỏng vấn với chất lượng âm thanh và hình ảnh theo thời gian thực (LiveKit Cloud SFU).
            </p>

            <form onSubmit={handleCreateCall} className="flex gap-3">
              <input
                type="text"
                placeholder="Nhập tên buổi phỏng vấn (VD: Phỏng vấn Senior Go Developer)..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="flex-1 px-4 py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={creating || !newTitle.trim()}
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>{creating ? 'Đang tạo...' : 'Tạo phòng'}</span>
              </button>
            </form>
          </div>
        </div>

        {/* Active Calls List */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>Các phòng đang hoạt động</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </h3>
            <button
              onClick={fetchCalls}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
            >
              Làm mới
            </button>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500 text-sm">Đang tải danh sách phòng...</div>
          ) : calls.length === 0 ? (
            <div className="p-12 rounded-2xl border border-slate-800 bg-slate-900/30 text-center text-slate-500 text-sm">
              Hiện chưa có phòng phỏng vấn nào đang mở. Hãy tạo phòng mới ở trên!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {calls.map((call) => {
                const timeStr = new Date(call.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <div
                    key={call.id}
                    className="p-6 rounded-2xl glass-panel border border-slate-800 hover:border-indigo-500/40 transition flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="px-2.5 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 text-xs font-semibold">
                          Mã: {call.room_name}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{timeStr}</span>
                        </span>
                      </div>
                      <h4 className="font-bold text-white text-base mb-1 group-hover:text-indigo-300 transition">
                        {call.title}
                      </h4>
                      <p className="text-xs text-slate-400">Trạng thái: Sẵn sàng kết nối</p>
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-end">
                      <button
                        onClick={() => onJoinCall(call.id, call.room_name, call.title)}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 shadow-md shadow-indigo-600/20 transition"
                      >
                        <Radio className="w-3.5 h-3.5 animate-pulse" />
                        <span>Tham gia phòng</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
