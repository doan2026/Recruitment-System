import { VideoRoom } from "@/components/VideoRoom";
import { PublicShell } from "@/components/PublicShell";

export default function InterviewRoomPage({ params }: { params: { id: string } }) {
  return (
    <PublicShell>
      <div className="page-header">
        <div>
          <p className="eyebrow">CareerHub Interview</p>
          <h1 className="page-title">Phòng phỏng vấn trực tuyến</h1>
          <p className="page-description">Vui lòng kiểm tra camera và micro trước khi bắt đầu.</p>
        </div>
      </div>
      
      <div className="panel" style={{ padding: 0, overflow: "hidden", minHeight: "550px" }}>
        <VideoRoom callId={params.id} />
      </div>
    </PublicShell>
  );
}
