"use client";

import { useRouter } from "next/navigation";
import { InterviewVideoRoom } from "@/components/InterviewVideoRoom";

export default function CandidateInterviewRoomPage({
  params
}: {
  params: { interviewId: string }
}) {
  const router = useRouter();

  return (
    <div style={{ height: "100%", width: "100%", background: "var(--surface)" }}>
      <InterviewVideoRoom
        interviewId={params.interviewId}
        role="CANDIDATE"
        onLeave={() => router.push("/candidate/interviews")}
      />
    </div>
  );
}
