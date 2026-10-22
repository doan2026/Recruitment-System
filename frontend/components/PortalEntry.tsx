"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useCurrentAccount } from "./SessionGate";
import { LoadingState } from "./ui";
import { portalHome, type AccountRole } from "@/lib/portalRoutes";

/** Public entry points never show another role's landing to a signed-in user. */
export function PortalEntry({ role, children }: { role: AccountRole; children: ReactNode }) {
  const account = useCurrentAccount();
  const router = useRouter();
  const destination = account && (account.role !== role || role === "RECRUITER") ? portalHome(account.role) : null;
  useEffect(() => { if (destination) router.replace(destination); }, [destination, router]);
  if (account === undefined || destination) return <div className="portal-boot"><LoadingState label="Đang mở không gian của bạn" /></div>;
  return children;
}
