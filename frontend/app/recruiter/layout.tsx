import { type ReactNode } from "react";
import { SessionGate } from "../../components/SessionGate";

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return <SessionGate role="RECRUITER">{children}</SessionGate>;
}
