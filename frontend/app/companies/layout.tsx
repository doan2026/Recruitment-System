import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Khám phá công ty" };

export default function CompaniesLayout({ children }: { children: ReactNode }) {
  return children;
}
