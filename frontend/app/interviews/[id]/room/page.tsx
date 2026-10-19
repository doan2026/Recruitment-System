"use client";

import { VideoRoom } from "@/components/VideoRoom";
import { PublicShell } from "@/components/PublicShell";
import { SessionGate, useCurrentAccount } from "@/components/SessionGate";
import { PageHeader } from "@/components/ui";

export default function InterviewRoomPage({ params }: { params: { id: string } }) {
  const account = useCurrentAccount();
  return <PublicShell><SessionGate role={account?.role === "RECRUITER" ? "RECRUITER" : "CANDIDATE"}>
    <main><PageHeader title="Cuộc gọi video" description="Bật camera và micro khi bạn sẵn sàng. Bạn có thể quay về cuộc trò chuyện sau khi rời phòng." />
      <div className="card" style={{ padding: 0, overflow: "hidden", minHeight: 550 }}><VideoRoom callId={params.id} /></div>
    </main>
  </SessionGate></PublicShell>;
}
