import Link from "next/link";
import { ApplyForm } from "../../../../components/ApplyForm";
import { toUserMessage } from "../../../../lib/apiClient";
import { getPublicJob, getRecommendationsForCandidate, type Job } from "../../../../lib/person2Api";

function formatCurrency(vnd: number) {
  return `${vnd.toLocaleString("vi-VN")} VNĐ`;
}

function JobChip({ title, value }: { title: string; value: string }) {
  return (
    <div className="stat">
      <strong>{title}</strong>
      <p className="help">{value}</p>
    </div>
  );
}

export default async function CandidateJobDetailPage({ params }: { params: { jobId: string } }) {
  let jobResp;
  let recResp;
  try {
    [jobResp, recResp] = await Promise.all([
      getPublicJob(params.jobId),
      getRecommendationsForCandidate(),
    ]);
  } catch (reason: unknown) {
    return (
      <main>
        <div className="notice notice-danger" role="alert">
          <strong>Chưa tải được việc làm</strong>
          <p>{toUserMessage(reason)}</p>
        </div>
        <Link className="btn" href="/candidate/jobs">Quay về danh sách</Link>
      </main>
    );
  }

  if (!jobResp.data) {
    return (
      <main>
        <h1 className="page-title">Không tìm thấy việc làm</h1>
        <Link className="btn" href="/candidate/jobs">
          Quay về danh sách
        </Link>
      </main>
    );
  }

  const job: Job = jobResp.data;
  const recForSameRole = recResp.data.filter((item) => item.source !== "LATEST").slice(0, 2);

  return (
    <main>
      <div className="section-head row-between">
        <h1 className="page-title">{job.title}</h1>
        <span className="badge">{job.status}</span>
      </div>

      <section className="grid-2">
        <section className="panel">
          <h2>Chi tiết</h2>
          <p className="help">Nguồn: {job.source} • {job.level} • {job.type}</p>
          <p>{job.description}</p>
          <div className="grid-2" style={{ marginTop: 14 }}>
            <JobChip title="Lương" value={job.isNegotiable ? "Thỏa thuận" : `${formatCurrency(job.salaryMin)} - ${job.salaryMax ? formatCurrency(job.salaryMax) : ""}`} />
            <JobChip title="Địa điểm" value={job.location} />
            <JobChip title="Skills" value={job.skills.join(", ")} />
            <JobChip title="Hạn nộp" value={new Date(job.deadline).toLocaleDateString("vi-VN")} />
          </div>
          <div className="btn-group" style={{ marginTop: 16 }}>
            <a className="btn btn-primary" href="#apply">
              Ứng tuyển ngay
            </a>
            <Link className="btn" href="/candidate/jobs">
              Quay danh sách
            </Link>
          </div>
        </section>

        <section className="panel">
          <h2>Phần ứng viên</h2>
          <p className="help">Form tạo hồ sơ gửi đúng `jobId`, `cvId`, `coverLetter` và `source`; version chỉ dùng cho lệnh ghi sau khi hồ sơ đã tồn tại.</p>
          <ApplyForm jobId={job.id} />
          <p className="status-line">Checklist: giữ form trên client nếu API trả `409 APPLICATION_CHANGED_CONCURRENTLY` sẽ mở lại dữ liệu mới.</p>
        </section>
      </section>

      <section className="panel">
        <h2>Gợi ý thay thế</h2>
        <div className="grid-2">
          {recForSameRole.map((item) => (
            <Link key={item.id} href={`/candidate/jobs/${item.id}`} className="card">
              <strong>{item.title}</strong>
              <p className="help">Match {item.matchPercent}% • {item.source}</p>
            </Link>
          ))}
          <div className="card">
            <p className="help">Nội dung gợi ý có thể đến từ AI, PREFERENCES hoặc LATEST dựa theo session của người dùng.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
