"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SessionGate } from "@/components/SessionGate";
import { RecruiterShell } from "@/components/RecruiterShell";

export default function PrivateLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/recruiter" || pathname === "/recruiter/login" || pathname === "/recruiter/register") return <>{children}</>;
  return <RecruiterShell><SessionGate role="RECRUITER">{children}</SessionGate></RecruiterShell>;
}
