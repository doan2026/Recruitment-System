import { ReactNode } from "react";
import { SessionGate } from "@/components/SessionGate";
import { AdminShell } from "@/components/AdminShell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate role="ADMIN">
      <AdminShell>{children}</AdminShell>
    </SessionGate>
  );
}
