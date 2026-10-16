"use client";

import { RecruiterApplicationPipeline } from "@/components/RecruiterApplicationPipeline";
import { PageHeader } from "@/components/ui";

export default function RecruiterApplicationsPage() {
  return <main>
    <PageHeader eyebrow="RECRUITER" title="Quản lý hồ sơ ứng tuyển" description="Xem và xử lý hồ sơ ứng viên của công ty." />
    <RecruiterApplicationPipeline />
  </main>;
}
