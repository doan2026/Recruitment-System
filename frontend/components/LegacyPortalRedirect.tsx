"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentAccount } from "./SessionGate";
import { LoadingState } from "./ui";
import { scopedDestination } from "@/lib/portalRoutes";

export function LegacyPortalRedirect() {
  const account = useCurrentAccount();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (account === undefined) return;
    const destination = scopedDestination(account?.role ?? "CANDIDATE", pathname) + window.location.search + window.location.hash;
    router.replace(account ? destination : `/login?returnTo=${encodeURIComponent(destination)}`);
  }, [account, pathname, router]);
  return <div className="portal-boot"><LoadingState label="Đang mở đúng khu vực của bạn" /></div>;
}
