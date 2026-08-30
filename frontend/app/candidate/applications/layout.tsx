import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Hồ sơ ứng tuyển" };

export default function CandidateApplicationsLayout({ children }: { children: ReactNode }) {
  return children;
}
