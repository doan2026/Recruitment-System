import { ReactNode } from "react";
import { SessionGate } from "@/components/SessionGate";
import { CandidateShell } from "@/components/CandidateShell";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate role="CANDIDATE">
      <CandidateShell>{children}</CandidateShell>
    </SessionGate>
  );
}
