import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Hồ sơ doanh nghiệp",
};

export default function CompanyDetailLayout({ children }: { children: ReactNode }) { return children; }
