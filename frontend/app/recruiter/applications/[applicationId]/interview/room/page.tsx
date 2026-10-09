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
        interviewId={`interview-for-${params.applicationId}`} // Mock logic vì url chỉ có applicationId
        role="RECRUITER"
        onLeave={() => router.push(`/recruiter/applications/${params.applicationId}`)}
      />
    </div>
  );
}
