"use client";

import { useEffect, useState } from "react";
import { applicationStatusTransitions, CandidateApplication, getApplications } from "../../../lib/demoData";

function fmtDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("vi-VN");
}

export default function CandidateApplicationsPage() {
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getApplications("cand-001").then((resp) => {
      if (live) setApplications(resp.data);
    });
    return () => {
      live = false;
    };
  }, []);

  function onAction(app: CandidateApplication, action: string) {
    const nextError = `${app.id}: hành động ${action} đã gửi đi`;
    setError(nextError);

    if (action === "WITHDRAWN") {
      setApplications((list) =>
        list.map((item) =>
          item.id === app.id
            ? {
                ...item,
                status: "WITHDRAWN",
                version: item.version + 1,
                notes: "Ứng viên tự rút hồ sơ",
              }
            : item,
        ),
      );
      return;
    }

    if (action === "HIRED") {
      setApplications((list) =>
        list.map((item) =>
          item.id === app.id
            ? {
                ...item,
                status: "HIRED",
                version: item.version + 1,
                notes: "Offer accepted",
              }
            : item,
        ),
      );
    }

    if (action === "REJECTED") {
      setApplications((list) =>
        list.map((item) =>
          item.id === app.id
            ? {
                ...item,
                status: "REJECTED",
                version: item.version + 1,
                lastRejectedAt: new Date().toISOString().slice(0, 10),
              }
            : item,
        ),
      );
    }
  }

  return (
    <main>
      <h1 className="page-title">Hồ sơ ứng tuyển của tôi</h1>
      <p className="help">Checklist machine-state và optimistic lock đang hiển thị trực quan trước khi gọi API.</p>
      {error ? <p className="notice">{error}</p> : null}
      <section className="stack">
        {applications.map((app) => {
          const allowed = applicationStatusTransitions[app.status] || [];

          return (
            <article className="panel" key={app.id}>
              <div className="section-head row-between">
                <div>
                  <strong>{app.jobTitle}</strong>
                  <p className="help">{app.companyName}</p>
                </div>
                <span className="badge">Ver {app.version}</span>
              </div>
              <p className="help">
                Trạng thái: <strong>{app.status}</strong> • Match {app.matchScore ?? 0}% • nộp ngày {fmtDate(app.createdAt)}
              </p>

              <p className="help">Hành động cho backend conflict: nếu `409` thì reload trước, giữ version mới rồi retry.</p>
              <div className="row-wrap">
                <span className="badge">candidateId: {app.candidateId}</span>
                <span className="badge">jobId: {app.jobId}</span>
                <span className="badge">email: {app.email}</span>
              </div>

              <div className="btn-group" style={{ marginTop: 10 }}>
                {allowed.map((action) => (
                  <button key={action} className={action === "REJECTED" ? "btn btn-danger" : "btn"} onClick={() => onAction(app, action)}>
                    {action}
                  </button>
                ))}
              </div>

              <p className="status-line">
                Ngày gợi ý tiếp tục sau từ chối: {app.status === "REJECTED" ? fmtDate(app.lastRejectedAt || new Date().toISOString()) : "-"}
              </p>
              {app.notes ? <p className="help">Ghi chú backend: {app.notes}</p> : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
