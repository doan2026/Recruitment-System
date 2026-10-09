import type { Metadata } from "next";
import { type ReactNode } from "react";
import { SessionGate } from "@/components/SessionGate";

export const metadata: Metadata = { title: "Hồ sơ ứng tuyển" };

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return <SessionGate role="CANDIDATE">{children}</SessionGate>;
}
