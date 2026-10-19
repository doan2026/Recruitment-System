"use client";

import { useRouter } from "next/navigation";
import { InterviewVideoRoom } from "@/components/InterviewVideoRoom";

export default function RecruiterInterviewRoomPage({
  params
}: {
  params: { applicationId: string }
}) {
  const router = useRouter();

  return (
    <div style={{ height: "100%", width: "100%", background: "var(--surface)" }}>
      <InterviewVideoRoom
        onLeave={() => router.push(`/recruiter/applications/${params.applicationId}`)}
      />
    </div>
  );
}
