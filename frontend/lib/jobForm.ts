export type RecruiterJobType = "FULL_TIME" | "PART_TIME" | "REMOTE" | "INTERNSHIP";

export interface RecruiterJobFormValues {
  title: string;
  description: string;
  requirements: string;
  benefits: string;
  salaryMin: string;
  salaryMax: string;
  isNegotiable: boolean;
  currency: string;
  location: string;
  jobType: RecruiterJobType;
  experienceYears: string;
  quantity: string;
  skills: string;
  deadline: string;
}

export interface RecruiterJobPayload {
  title: string;
  description: string;
  requirements: string;
  benefits: string;
  salaryMin?: number;
  salaryMax?: number;
  isNegotiable: boolean;
  currency: string;
  location: string;
  jobType: RecruiterJobType;
  experienceYears: number;
  quantity: number;
  skills: string[];
  deadline: string;
}

export type RecruiterJobFormErrors = Partial<Record<keyof RecruiterJobFormValues | "salary", string>>;

export const emptyRecruiterJobForm: RecruiterJobFormValues = {
  title: "",
  description: "",
  requirements: "",
  benefits: "",
  salaryMin: "",
  salaryMax: "",
  isNegotiable: false,
  currency: "VND",
  location: "Hà Nội",
  jobType: "FULL_TIME",
  experienceYears: "0",
  quantity: "1",
  skills: "React, TypeScript",
  deadline: "",
};

export function normalizeJobSkills(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw.split(",")) {
    const skill = value.normalize("NFKC").trim();
    const key = skill.toLocaleLowerCase("vi");
    if (skill && !seen.has(key)) {
      seen.add(key);
      result.push(skill);
    }
  }
  return result;
}

function isDateAfterUtcToday(value: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const deadline = new Date(`${value}T00:00:00.000Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Number.isFinite(deadline.getTime()) && deadline.getTime() > today;
}

export function validateRecruiterJobForm(
  values: RecruiterJobFormValues,
  now = new Date(),
): RecruiterJobFormErrors {
  const errors: RecruiterJobFormErrors = {};
  const title = values.title.normalize("NFKC").trim();
  if (title.length < 2 || title.length > 200) errors.title = "Tên vị trí phải có từ 2 đến 200 ký tự.";
  if (!values.description.trim() || values.description.length > 20_000) errors.description = "Mô tả công việc phải có từ 1 đến 20.000 ký tự.";
  if (!values.requirements.trim() || values.requirements.length > 20_000) errors.requirements = "Yêu cầu ứng viên phải có từ 1 đến 20.000 ký tự.";
  if (!values.benefits.trim() || values.benefits.length > 20_000) errors.benefits = "Quyền lợi phải có từ 1 đến 20.000 ký tự.";
  const location = values.location.normalize("NFKC").trim();
  if (!location || location.length > 255) errors.location = "Địa điểm phải có từ 1 đến 255 ký tự.";
  if (!["FULL_TIME", "PART_TIME", "REMOTE", "INTERNSHIP"].includes(values.jobType)) errors.jobType = "Chọn hình thức tuyển dụng hợp lệ.";
  if (!/^[A-Z]{3}$/.test(values.currency.trim().toUpperCase())) errors.currency = "Nhập mã tiền tệ gồm 3 chữ cái, ví dụ VND hoặc USD.";
  if (!isDateAfterUtcToday(values.deadline, now)) errors.deadline = "Hạn nộp phải sau hôm nay.";

  const experienceYears = Number(values.experienceYears);
  if (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 60) {
    errors.experienceYears = "Kinh nghiệm phải là số nguyên từ 0 đến 60 năm.";
  }
  const quantity = Number(values.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
    errors.quantity = "Số lượng tuyển phải là số nguyên từ 1 đến 10.000.";
  }

  const skills = normalizeJobSkills(values.skills);
  if (!skills.length || skills.length > 50) errors.skills = "Nhập từ 1 đến 50 kỹ năng không rỗng.";

  if (!values.isNegotiable) {
    if (!values.salaryMin.trim() || !values.salaryMax.trim()) {
      errors.salary = "Nhập đủ lương tối thiểu và lương tối đa.";
    } else {
      const salaryMin = Number(values.salaryMin);
      const salaryMax = Number(values.salaryMax);
      if (!Number.isFinite(salaryMin) || !Number.isFinite(salaryMax) || salaryMin < 0 || salaryMax < 0 || salaryMin > salaryMax) {
        errors.salary = "Lương phải là số không âm và lương tối thiểu không lớn hơn tối đa.";
      }
    }
  }
  return errors;
}

export function normalizeRecruiterJobForm(values: RecruiterJobFormValues): RecruiterJobPayload {
  const payload: RecruiterJobPayload = {
    title: values.title.normalize("NFKC").trim(),
    description: values.description.trim(),
    requirements: values.requirements.trim(),
    benefits: values.benefits.trim(),
    isNegotiable: values.isNegotiable,
    currency: values.currency.trim().toUpperCase(),
    location: values.location.normalize("NFKC").trim(),
    jobType: values.jobType,
    experienceYears: Number(values.experienceYears),
    quantity: Number(values.quantity),
    skills: normalizeJobSkills(values.skills),
    deadline: values.deadline,
  };
  if (!values.isNegotiable) {
    payload.salaryMin = Number(values.salaryMin);
    payload.salaryMax = Number(values.salaryMax);
  }
  return payload;
}

// Mirrors the Job Service rule: only these normalized fields send a PUBLISHED
// job back to admin review; deadline, quantity, skills… are applied at once.
const REVIEW_FIELDS = ["title", "description", "requirements", "isNegotiable", "currency", "salaryMin", "salaryMax"] as const;

export function jobEditRequiresReview(original: RecruiterJobFormValues, draft: RecruiterJobFormValues): boolean {
  const before = normalizeRecruiterJobForm(original);
  const after = normalizeRecruiterJobForm(draft);
  return REVIEW_FIELDS.some((field) => before[field] !== after[field]);
}
