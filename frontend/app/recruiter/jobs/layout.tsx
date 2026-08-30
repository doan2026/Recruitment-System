import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Quản lý tin tuyển dụng" };

export default function RecruiterJobsLayout({ children }: { children: ReactNode }) {
  return children;
}
