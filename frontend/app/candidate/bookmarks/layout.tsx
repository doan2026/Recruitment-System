import type { Metadata } from "next";
import { type ReactNode } from "react";
import { SessionGate } from "@/components/SessionGate";

export const metadata: Metadata = { title: "Việc làm đã lưu" };

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return <SessionGate role="CANDIDATE">{children}</SessionGate>;
}
