import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PublicShell } from "@/components/PublicShell";

export const metadata: Metadata = { title: "Khám phá công ty" };

export default function CompaniesLayout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
