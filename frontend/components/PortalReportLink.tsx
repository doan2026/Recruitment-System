"use client";

import Link from "next/link";
import { useCurrentAccount } from "./SessionGate";
import { portalSection } from "@/lib/portalRoutes";

export function PortalReportLink({ targetId }: { targetId: string }) {
  const account = useCurrentAccount();
  if (account?.role === "ADMIN") return <Link className="btn" href="/admin/reports">Xem báo cáo vi phạm</Link>;
  return <Link className="btn" href={`${portalSection(account?.role ?? "CANDIDATE", "reports")}?type=COMPANY&id=${encodeURIComponent(targetId)}`}>Báo cáo công ty</Link>;
}
