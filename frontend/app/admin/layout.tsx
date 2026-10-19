"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Person1Gate } from "../../components/Person1Gate";
import { AdminShell } from "../../components/AdminShell";
export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin/login") return <>{children}</>;
  return <AdminShell><Person1Gate role="ADMIN">{children}</Person1Gate></AdminShell>;
}
