import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Việc làm" };

export default function CandidateJobsLayout({ children }: { children: ReactNode }) {
  return children;
}
