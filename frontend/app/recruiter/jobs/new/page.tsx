"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "../../../../components/ui";

export default function CreateJobPage() {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [skills, setSkills] = useState("React, TypeScript");
  const [submitted, setSubmitted] = useState(false);

  const errors = useMemo(() => {
    const result: Record<string, string> = {};
    if (!title.trim()) result.title = "Nhập tên vị trí.";
    if (!deadline || new Date(deadline) <= new Date()) result.deadline = "Hạn nộp phải sau hôm nay.";
    const skillList = skills.split(",").map((skill) => skill.trim()).filter(Boolean);
    if (skillList.length === 0 || skillList.length > 50) result.skills = "Nhập từ 1 đến 50 kỹ năng.";
    if (!negotiable) {
      const min = Number(salaryMin);
      const max = Number(salaryMax);
      if (!min || !max || min > max) result.salary = "Nhập đủ mức lương và bảo đảm lương tối thiểu không lớn hơn tối đa.";
    }
    return result;
  }, [deadline, negotiable, salaryMax, salaryMin, skills, title]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) {
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }
  }

  return (
    <main>
      <PageHeader eyebrow="RECRUITER · NEW JOB" title="Tạo tin tuyển dụng" description="Tin mới được lưu ở trạng thái bản nháp. Bạn sẽ gửi đi chờ duyệt sau khi kiểm tra." />
      {submitted && Object.keys(errors).length === 0 ? <p className="notice notice-success" role="status">Đã lưu bản nháp. Phiên bản hiện tại: v1.</p> : null}
      {submitted && Object.keys(errors).length > 0 ? <p className="notice notice-danger" role="alert">Kiểm tra lại {Object.keys(errors).length} nhóm thông tin chưa hợp lệ.</p> : null}
      <form className="panel form-grid" noValidate onSubmit={submit}>
        <div className="field span-2">
          <label className="label" htmlFor="title">Tên vị trí</label>
          <input id="title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={submitted && !!errors.title} aria-describedby={submitted && errors.title ? "title-error" : undefined} placeholder="Ví dụ: Senior Frontend Developer" />
          {submitted && errors.title ? <span id="title-error" className="form-error">{errors.title}</span> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="location">Địa điểm</label>
          <input id="location" className="input" defaultValue="Hà Nội" />
        </div>
        <div className="field">
          <label className="label" htmlFor="job-type">Hình thức</label>
          <select id="job-type" className="select" defaultValue="FULLTIME"><option value="FULLTIME">Toàn thời gian</option><option value="PARTTIME">Bán thời gian</option><option value="CONTRACT">Hợp đồng</option></select>
        </div>
        <div className="field">
          <label className="label" htmlFor="deadline">Hạn nộp</label>
          <input id="deadline" className="input" type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} aria-invalid={submitted && !!errors.deadline} aria-describedby={submitted && errors.deadline ? "deadline-error" : undefined} />
          {submitted && errors.deadline ? <span id="deadline-error" className="form-error">{errors.deadline}</span> : null}
        </div>
        <div className="field">
          <span className="label">Chính sách lương</span>
          <label className="row"><input type="checkbox" checked={negotiable} onChange={(event) => setNegotiable(event.target.checked)} /> Thỏa thuận khi phỏng vấn</label>
        </div>
        {!negotiable ? <>
          <div className="field"><label className="label" htmlFor="salary-min">Lương tối thiểu</label><input id="salary-min" className="input" inputMode="numeric" value={salaryMin} onChange={(event) => setSalaryMin(event.target.value)} placeholder="18000000" /></div>
          <div className="field"><label className="label" htmlFor="salary-max">Lương tối đa</label><input id="salary-max" className="input" inputMode="numeric" value={salaryMax} onChange={(event) => setSalaryMax(event.target.value)} placeholder="25000000" />{submitted && errors.salary ? <span className="form-error">{errors.salary}</span> : null}</div>
        </> : null}
        <div className="field span-2">
          <label className="label" htmlFor="skills">Kỹ năng, phân tách bằng dấu phẩy</label>
          <input id="skills" className="input" value={skills} onChange={(event) => setSkills(event.target.value)} aria-invalid={submitted && !!errors.skills} aria-describedby={submitted && errors.skills ? "skills-error" : undefined} />
          {submitted && errors.skills ? <span id="skills-error" className="form-error">{errors.skills}</span> : null}
        </div>
        <div className="field span-2"><label className="label" htmlFor="description">Mô tả công việc</label><textarea id="description" className="textarea resize-none" rows={7} defaultValue="Mô tả vai trò, phạm vi trách nhiệm và cách đội ngũ phối hợp." /></div>
        <div className="field span-2"><label className="label" htmlFor="requirements">Yêu cầu ứng viên</label><textarea id="requirements" className="textarea resize-none" rows={6} defaultValue="Kinh nghiệm thực tế với React, TypeScript và kiểm thử frontend." /></div>
        <div className="span-2 btn-group"><button className="btn btn-primary" type="submit">Lưu bản nháp</button><Link className="btn" href="/recruiter/jobs">Hủy</Link></div>
      </form>
    </main>
  );
}
