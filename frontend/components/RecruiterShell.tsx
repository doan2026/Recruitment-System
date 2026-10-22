"use client";

import type { ReactNode } from "react";
import { LayoutDashboard, BriefcaseBusiness, Files, UsersRound, Building2, MailPlus, MessageSquare, Bell } from "lucide-react";
import { useCurrentAccount } from "./SessionGate";
import { WorkspaceShell, type WorkspaceLink } from "./WorkspaceShell";
const links: WorkspaceLink[] = [
  { href: "/recruiter/dashboard", label: "Trang chủ", icon: LayoutDashboard },
  { href: "/recruiter/jobs", label: "Quản lý tin tuyển dụng", icon: BriefcaseBusiness },
  { href: "/recruiter/applications", label: "Hồ sơ ứng tuyển", icon: Files },
  { href: "/recruiter/candidate-recommendations", label: "Ứng viên gợi ý", icon: UsersRound },
  { href: "/recruiter/company", label: "Hồ sơ công ty", icon: Building2 },
  { href: "/recruiter/invitations/accept", label: "Nhận lời mời", icon: MailPlus },
  { href: "/recruiter/messages", label: "Tin nhắn", icon: MessageSquare },
  { href: "/recruiter/notifications", label: "Thông báo", icon: Bell },
];
export function RecruiterShell({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  return <WorkspaceShell role="recruiter" title="Nhà tuyển dụng" navigationLabel="Khu vực nhà tuyển dụng" links={links} showNavigation={account?.role === "RECRUITER"} name={account?.email}>{children}</WorkspaceShell>;
}
