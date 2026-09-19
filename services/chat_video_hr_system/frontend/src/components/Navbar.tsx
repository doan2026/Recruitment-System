import React from 'react';
import { useAuth } from '../auth/AuthProvider';
import { NotificationBell } from '../notification/NotificationBell';
import { Video, MessageSquare, LogOut, User as UserIcon, Shield } from 'lucide-react';
import { AppNotification } from '../api/notification';

interface NavbarProps {
  currentTab: 'chat' | 'video';
  onTabChange: (tab: 'chat' | 'video') => void;
  onSelectNotification?: (notif: AppNotification) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onTabChange, onSelectNotification }) => {
  const { user, logout } = useAuth();

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-40">
      {/* Brand */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 font-bold">
            <Video className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-extrabold text-white text-base tracking-tight leading-none">
              Interview Platform
            </h1>
            <span className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider">
              Realtime System
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => onTabChange('chat')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              currentTab === 'chat'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Tin nhắn</span>
          </button>

          <button
            onClick={() => onTabChange('video')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              currentTab === 'video'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>Phỏng vấn Video</span>
          </button>
        </nav>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3">
        {/* SSE Notification Bell */}
        <NotificationBell onSelectNotification={onSelectNotification} />

        {/* User Info */}
        <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-indigo-300 font-bold flex items-center justify-center text-sm">
            {user?.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'}
          </div>
          <div className="hidden md:block text-left">
            <div className="text-xs font-semibold text-white">{user?.full_name}</div>
            <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{user?.email}</div>
          </div>
          <button
            onClick={logout}
            className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
            title="Đăng xuất"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
