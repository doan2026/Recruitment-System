"use client";

import { useCurrentAccount } from "@/components/SessionGate";
import { CandidateShell } from "@/components/CandidateShell";
import { RecruiterShell } from "@/components/RecruiterShell";
import { AdminShell } from "@/components/AdminShell";
import { useNotifications } from "@/components/NotificationProvider";
import { PageHeader, EmptyState } from "@/components/ui";
function NotificationsList() {
  const { notifications, loading, hasMore, loadMore, markAsRead, markAllAsRead, unreadCount } = useNotifications();

  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", marginBottom: "24px" }}>
        <PageHeader
          title="Thông báo"
          description={`Cập nhật các hoạt động mới nhất liên quan đến bạn. (${unreadCount} chưa đọc)`}
        />
        <button className="btn" onClick={markAllAsRead} disabled={unreadCount === 0 || loading}>
          Đánh dấu tất cả là đã đọc
        </button>
      </div>

      <div className="card stack" style={{ padding: "16px 24px" }}>
        {notifications.length === 0 && !loading && (
          <EmptyState title="Chưa có thông báo" description="Bạn hiện không có thông báo nào mới." />
        )}
        
        {notifications.map(n => (
          <div 
            key={n.id} 
            style={{ display: "flex", gap: "16px", padding: "16px 0", borderBottom: "1px solid var(--line)", cursor: n.is_read ? "default" : "pointer" }}
            onClick={() => !n.is_read && markAsRead(n.id)}
          >
            <div style={{ width: 8, height: 8, borderRadius: 4, background: n.is_read ? "transparent" : "var(--primary)", marginTop: 6, flexShrink: 0 }} />
            <div>
              <p style={{ margin: "0 0 4px", color: n.is_read ? "var(--muted)" : "var(--text)", fontWeight: n.is_read ? "normal" : "500" }}>{n.title}: {n.body}</p>
              <small className="muted">{new Date(n.created_at).toLocaleString()}</small>
            </div>
          </div>
        ))}

        {hasMore && (
          <button className="btn" style={{ marginTop: 16 }} onClick={loadMore} disabled={loading}>
            {loading ? "Đang tải..." : "Tải thêm"}
          </button>
        )}
      </div>
    </main>
  );
}

export default function NotificationsPage() {
  const account = useCurrentAccount();

  if (!account) return null;

  if (account.role === "CANDIDATE") {
    return <CandidateShell><NotificationsList /></CandidateShell>;
  }

  if (account.role === "RECRUITER") {
    return <RecruiterShell><NotificationsList /></RecruiterShell>;
  }
  
  if (account.role === "ADMIN") {
    return <AdminShell><NotificationsList /></AdminShell>;
  }

  return (
    <main>
      <PageHeader title="Lỗi quyền truy cập" />
      <EmptyState title="Không hỗ trợ" description="Tính năng thông báo không dành cho vai trò của bạn." />
    </main>
  );
}
