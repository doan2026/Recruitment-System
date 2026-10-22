import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ApiSessionBoundary } from "@/components/ApiSessionBoundary";
import { NotificationProvider } from "@/components/NotificationProvider";
import "./globals.css";
import "./portal.css";

export const metadata: Metadata = {
  title: { default: "CareerHub", template: "%s — CareerHub" },
  description: "Nền tảng tuyển dụng kết nối ứng viên và doanh nghiệp.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <NotificationProvider>
          <ApiSessionBoundary>
            {children}
          </ApiSessionBoundary>
        </NotificationProvider>
      </body>
    </html>
  );
}
