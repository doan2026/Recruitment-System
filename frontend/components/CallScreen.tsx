"use client";

import dynamic from "next/dynamic";
import { PageHeader, LoadingState } from "./ui";

const VideoRoom = dynamic(() => import("./VideoRoom").then(module => module.VideoRoom), {
  ssr: false, loading: () => <LoadingState label="Đang chuẩn bị phòng gọi" />,
});

export default function CallScreen({ params }: { params: { id: string } }) {
  return <main><PageHeader title="Cuộc gọi video" description="Bật camera và micro khi bạn sẵn sàng. Bạn có thể quay về cuộc trò chuyện sau khi rời phòng." />
    <div className="card call-room"><VideoRoom callId={params.id} /></div>
  </main>;
}
