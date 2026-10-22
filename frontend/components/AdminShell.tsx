"use client";

import type { ReactNode } from "react";
import { LayoutDashboard, UsersRound, BriefcaseBusiness, Building2, Flag, Bell, ClipboardList } from "lucide-react";
import { useCurrentAccount } from "./SessionGate";
import { WorkspaceShell, type WorkspaceLink } from "./WorkspaceShell";
const links: WorkspaceLink[] = [
  { href: "/admin", label: "Tổng quan", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Quản lý người dùng", icon: UsersRound },
  { href: "/admin/jobs", label: "Duyệt tin tuyển dụng", icon: BriefcaseBusiness },
  { href: "/admin/companies", label: "Duyệt công ty", icon: Building2 },
  { href: "/admin/reports", label: "Báo cáo vi phạm", icon: Flag },
  { href: "/admin/audit", label: "Nhật ký hoạt động", icon: ClipboardList },
  { href: "/admin/notifications", label: "Thông báo", icon: Bell },
];
export function AdminShell({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  return <WorkspaceShell role="admin" title="Quản trị viên" navigationLabel="Chức năng quản trị" links={links} showNavigation={account?.role === "ADMIN"} name={account?.email}>{children}</WorkspaceShell>;
}
