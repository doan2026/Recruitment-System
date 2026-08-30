"use client";

import { useState } from "react";

export function ApplyForm({ jobId }: { jobId: string }) {
  const [cvId, setCvId] = useState("cv-frontend-01");
  const [note, setNote] = useState("Tôi có kinh nghiệm phù hợp với yêu cầu vị trí. Mong được vào vòng tiếp theo.");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    window.setTimeout(() => {
      setPending(false);
      setMessage(`Đã tạo bản xem trước ứng tuyển cho .`);
    }, 450);
  }

  return (
    <form className="card" id="apply" noValidate onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor="apply-cv">CV dùng để ứng tuyển</label>
        <select id="apply-cv" className="select" value={cvId} onChange={(event) => setCvId(event.target.value)}>
          <option value="cv-frontend-01">CV Frontend Senior</option>
          <option value="cv-frontend-02">CV Frontend Junior</option>
        </select>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label className="label" htmlFor="apply-note">Ghi chú ứng viên (tùy chọn)</label>
        <textarea id="apply-note" className="textarea resize-none" rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      <div className="btn-group" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Đang gửi…" : "Gửi ứng tuyển"}
        </button>
      </div>
      {message ? <p className="notice notice-success" role="status">{message}</p> : null}
    </form>
  );
}
