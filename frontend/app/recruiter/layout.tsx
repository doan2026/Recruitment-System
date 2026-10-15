import { type ReactNode } from "react";
import { SessionGate } from "@/components/SessionGate";
import { RecruiterShell } from "@/components/RecruiterShell";

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate role="RECRUITER">
      <RecruiterShell>{children}</RecruiterShell>
    </SessionGate>
  );
}
