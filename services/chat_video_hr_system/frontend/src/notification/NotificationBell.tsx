import React, { useState, useRef, useEffect } from 'react';
import { useNotificationSSE } from './useNotificationSSE';
import { NotificationList } from './NotificationList';
import { AppNotification } from '../api/notification';
import { Bell } from 'lucide-react';

interface NotificationBellProps {
  onSelectNotification?: (notif: AppNotification) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ onSelectNotification }) => {
  const { notifications, unreadCount, markRead } = useNotificationSSE();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white transition"
        title="Thông báo"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 px-1.5 py-0.5 min-w-[18px] text-[10px] font-bold bg-indigo-600 text-white rounded-full flex items-center justify-center animate-pulse shadow-md">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 glass-panel bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-white text-sm">Thông báo</h3>
            <span className="text-xs text-indigo-400 font-medium">
              {unreadCount} chưa đọc
            </span>
          </div>

          <NotificationList
            notifications={notifications}
            onMarkRead={markRead}
            onSelectNotification={(n) => {
              setIsOpen(false);
              onSelectNotification?.(n);
            }}
          />
        </div>
      )}
    </div>
  );
};
