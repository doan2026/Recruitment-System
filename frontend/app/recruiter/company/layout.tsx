import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Hồ sơ công ty" };

export default function RecruiterCompanyLayout({ children }: { children: ReactNode }) {
  return children;
}
