export type CompanyVerificationStatus = "DRAFT" | "PENDING" | "VERIFIED" | "REJECTED";
export type JobStatus = "DRAFT" | "PENDING_APPROVAL" | "PUBLISHED" | "CLOSED" | "EXPIRED";
export type SearchMode = "OFFSET" | "CURSOR";
export type JobDataSource = "ELASTICSEARCH" | "POSTGRESQL";
export type RecommendationSource = "AI" | "PREFERENCES" | "LATEST";
export type FallbackReason =
  | "NO_ACTIVE_CV"
  | "PROFILE_UNAVAILABLE"
  | "AI_UNAVAILABLE"
  | "AI_NOT_READY"
  | "AI_RESPONSE_INVALID"
  | "AI_RESULTS_STALE"
  | "NO_DISCOVERABLE_CANDIDATES"
  | "JOB_EMBEDDING_NOT_FOUND"
  | "JOB_EMBEDDING_INACTIVE"
  | "NO_ACTIVE_CV_EMBEDDINGS"
  | "EMBEDDING_MODEL_MISMATCH"
  | "NO_MATCHING_CV_EMBEDDINGS";

export type ApplicationStatus =
  | "APPLIED"
  | "REVIEWING"
  | "INTERVIEW"
  | "OFFER"
  | "HIRED"
  | "REJECTED"
  | "WITHDRAWN";

export type OfferStatus = "DRAFT" | "PENDING_CANDIDATE_RESPONSE" | "ACCEPTED" | "DECLINED" | "EXPIRED";

export type RecommendationCursorState = "ACTIVE" | "STALE";

export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    source?: string;
    cursor?: string | null;
    hasMore?: boolean;
    nextCursor?: string | null;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: {
    reason?: string;
    currentStatus?: string;
    retryAfterSeconds?: number;
    eligibleAt?: string;
    fallbackReason?: string;
  };
}

export interface Company {
  id: string;
  name: string;
  shortName: string;
  taxCode: string;
  ownerName: string;
  aggregateVersion: number;
  verificationStatus: CompanyVerificationStatus;
  rejectReason?: string;
  media: {
    logo?: { fileId: string; url: string };
    gallery: { fileId: string; url: string; type: "IMAGE" | "VIDEO"; sortOrder: number }[];
  };
  createdAt: string;
  updatedAt: string;
  pendingMediaSlot?: {
    fileId: string;
    uploadUrl: string;
    expiresAt: string;
  };
}

export interface Job {
  id: string;
  companyId: string;
  title: string;
  level: string;
  type: "FULLTIME" | "PARTTIME" | "CONTRACT";
  location: string;
  department: string;
  salaryMin: number;
  salaryMax: number | null;
  currency: "VND";
  isNegotiable: boolean;
  description: string;
  requirements: string[];
  responsibilities: string[];
  benefits: string[];
  skills: string[];
  status: JobStatus;
  deadline: string;
  source: JobDataSource;
  ownerName: string;
  aggregateVersion: number;
  createdAt: string;
  updatedAt: string;
  memberRole?: "OWNER" | "MEMBER";
  fallbackReason?: FallbackReason;
}

export interface JobRecommendation {
  id: string;
  title: string;
  matchPercent: number;
  source: RecommendationSource;
  fallbackReason?: FallbackReason;
  nextCursor?: string | null;
  reasonText: string;
}

export interface CandidateApplication {
  id: string;
  candidateId: string;
  candidateName: string;
  email: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  status: ApplicationStatus;
  version: number;
  offerVersion?: number;
  matchScore?: number;
  createdAt: string;
  expectedAt?: string;
  expectedOfferVersion?: number;
  lastRejectedAt?: string;
  notes?: string;
  hasCv?: boolean;
}

export interface Offer {
  id: string;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  salary: string;
  offerVersion: number;
  applicationVersion: number;
  expiresAt: string;
  status: OfferStatus;
  fileId?: string;
  fileUrl?: string;
}

const baseAt = (offset: number) => {
  const date = new Date(2026, 7, 30);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const wrapSuccess = <T,>(data: T, meta?: ApiEnvelope<T>["meta"]): Promise<ApiEnvelope<T>> => {
  return sleep(120).then(() => ({ data, meta }));
};

export const companies: Company[] = [
  {
    id: "cmp-techvision",
    name: "TechVision JSC",
    shortName: "TechVision",
    taxCode: "0101234567",
    ownerName: "Nguyen Van A",
    aggregateVersion: 5,
    verificationStatus: "PENDING",
    rejectReason: "Chưa có tài liệu xác nhận pháp lý đầy đủ.",
    media: {
      logo: { fileId: "f-logo-001", url: "/placeholder-company.png" },
      gallery: [
        { fileId: "f-gal-001", url: "/placeholder-office-1.png", type: "IMAGE", sortOrder: 0 },
        { fileId: "f-gal-002", url: "/placeholder-office-2.png", type: "IMAGE", sortOrder: 1 },
      ],
    },
    createdAt: baseAt(-120),
    updatedAt: baseAt(-2),
  },
];

export const jobs: Job[] = [
  {
    id: "job-frontend-001",
    companyId: "cmp-techvision",
    title: "Frontend Developer",
    level: "Senior",
    type: "FULLTIME",
    location: "Ha Noi",
    department: "Engineering",
    salaryMin: 18000000,
    salaryMax: 25000000,
    currency: "VND",
    isNegotiable: false,
    description:
      "Build và maintain product web, cải tiến UI/UX và chuẩn hóa hệ thống component.",
    requirements: ["React", "TypeScript", "Performance tuning", "Testing"],
    responsibilities: ["Phối hợp với product", "Code review", "Viết tài liệu kỹ thuật"],
    benefits: ["Làm việc remote 2 ngày/tuần", "Healthcare", "Laptop hỗ trợ"],
    skills: ["React", "TypeScript", "Next.js", "Jest"],
    status: "PUBLISHED",
    deadline: baseAt(45),
    source: "ELASTICSEARCH",
    ownerName: "Nguyen Van A",
    aggregateVersion: 12,
    createdAt: baseAt(-34),
    updatedAt: baseAt(-1),
    memberRole: "OWNER",
  },
  {
    id: "job-ai-002",
    companyId: "cmp-techvision",
    title: "AI Engineer",
    level: "Mid-level",
    type: "FULLTIME",
    location: "Ho Chi Minh",
    department: "Data Science",
    salaryMin: 24000000,
    salaryMax: 35000000,
    currency: "VND",
    isNegotiable: false,
    description: "Xây dựng pipeline AI, triển khai vector search và monitoring mô hình.",
    requirements: ["Python", "PyTorch", "PostgreSQL", "Redis"],
    responsibilities: ["Thiết kế sản phẩm AI", "Tối ưu mô hình"],
    benefits: ["Thưởng KPI", "Training", "Bảo hiểm mở rộng"],
    skills: ["Python", "FastAPI", "AI", "pgvector"],
    status: "PUBLISHED",
    deadline: baseAt(28),
    source: "POSTGRESQL",
    ownerName: "Nguyen Van B",
    aggregateVersion: 3,
    createdAt: baseAt(-20),
    updatedAt: baseAt(-1),
    memberRole: "MEMBER",
  },
  {
    id: "job-product-003",
    companyId: "cmp-techvision",
    title: "Product Manager",
    level: "Lead",
    type: "CONTRACT",
    location: "Da Nang",
    department: "Product",
    salaryMin: 30000000,
    salaryMax: null,
    currency: "VND",
    isNegotiable: true,
    description: "Lên roadmap sản phẩm và chạy vòng phỏng vấn kỹ thuật.",
    requirements: ["Agile", "Roadmap", "Jira", "Analytics"],
    responsibilities: ["Chiến lược sản phẩm", "Làm việc với recruiter"],
    benefits: ["Bonus theo mục tiêu", "Bonus linh hoạt"],
    skills: ["Scrum", "Stakeholder management", "Data"],
    status: "DRAFT",
    deadline: baseAt(21),
    source: "ELASTICSEARCH",
    ownerName: "Nguyen Van A",
    aggregateVersion: 1,
    createdAt: baseAt(-5),
    updatedAt: baseAt(-5),
  },
  {
    id: "job-hr-004",
    companyId: "cmp-techvision",
    title: "HRBP",
    level: "Junior",
    type: "FULLTIME",
    location: "Ha Noi",
    department: "People",
    salaryMin: 12000000,
    salaryMax: 18000000,
    currency: "VND",
    isNegotiable: false,
    description: "Tuyển dụng talent pipeline và hỗ trợ onboarding.",
    requirements: ["Communication", "Recruitment", "Interviewing"],
    responsibilities: ["Định hướng nhân sự", "Làm việc phối hợp"],
    benefits: ["Môi trường năng động", "Remote policy"],
    skills: ["Hiring", "Onboarding", "Policy"],
    status: "CLOSED",
    deadline: baseAt(-2),
    source: "POSTGRESQL",
    ownerName: "Nguyen Van C",
    aggregateVersion: 8,
    createdAt: baseAt(-60),
    updatedAt: baseAt(-1),
    fallbackReason: "NO_ACTIVE_CV",
  },
  {
    id: "job-mobile-005",
    companyId: "cmp-techvision",
    title: "Mobile Developer",
    level: "Mid-level",
    type: "FULLTIME",
    location: "Remote",
    department: "Engineering",
    salaryMin: 17000000,
    salaryMax: 22000000,
    currency: "VND",
    isNegotiable: false,
    description: "Xây dựng ứng dụng iOS/Android theo chuẩn security & performance.",
    requirements: ["Flutter", "CI/CD", "API Integrations"],
    responsibilities: ["Lập kế hoạch sprint", "Release app"],
    benefits: ["Mobile allowance", "Work from home", "Tech budget"],
    skills: ["Flutter", "Node", "GitOps"],
    status: "EXPIRED",
    deadline: baseAt(-7),
    source: "ELASTICSEARCH",
    ownerName: "Nguyen Van A",
    aggregateVersion: 9,
    createdAt: baseAt(-90),
    updatedAt: baseAt(-7),
    fallbackReason: "AI_RESPONSE_INVALID",
  },
];

export const jobRecommendations: JobRecommendation[] = [
  {
    id: "rec-job-frontend-001",
    title: "Frontend Developer",
    matchPercent: 92,
    source: "AI",
    reasonText: "Profile trùng tốt kỹ năng React, Next.js và testing.",
  },
  {
    id: "rec-job-hr-004",
    title: "HRBP",
    matchPercent: 81,
    source: "PREFERENCES",
    reasonText: "Cập nhật khi người dùng chọn nhánh People & Recruiting.",
    nextCursor: null,
    fallbackReason: "NO_ACTIVE_CV",
  },
  {
    id: "rec-job-ai-002",
    title: "AI Engineer",
    matchPercent: 79,
    source: "LATEST",
    reasonText: "Dựa trên việc nộp trước đó và vị trí gần nhất trong hồ sơ.",
    fallbackReason: "AI_NOT_READY",
  },
];

export const applications: CandidateApplication[] = [
  {
    id: "app-001",
    candidateId: "cand-001",
    candidateName: "Anh Tuan",
    email: "tuan.nguyen@sample.com",
    jobId: "job-frontend-001",
    jobTitle: "Frontend Developer",
    companyName: "TechVision",
    status: "REVIEWING",
    version: 3,
    matchScore: 89,
    createdAt: baseAt(-14),
    hasCv: true,
  },
  {
    id: "app-002",
    candidateId: "cand-002",
    candidateName: "Linh Le",
    email: "linh.le@sample.com",
    jobId: "job-frontend-001",
    jobTitle: "Frontend Developer",
    companyName: "TechVision",
    status: "APPLIED",
    version: 1,
    matchScore: 76,
    createdAt: baseAt(-3),
    hasCv: true,
  },
  {
    id: "app-003",
    candidateId: "cand-003",
    candidateName: "Vu Nguyen",
    email: "vu.nguyen@sample.com",
    jobId: "job-ai-002",
    jobTitle: "AI Engineer",
    companyName: "TechVision",
    status: "OFFER",
    version: 4,
    offerVersion: 1,
    expectedOfferVersion: 1,
    expectedAt: baseAt(-2),
    createdAt: baseAt(-20),
    hasCv: true,
  },
  {
    id: "app-004",
    candidateId: "cand-004",
    candidateName: "Thu Ha",
    email: "thu.ha@sample.com",
    jobId: "job-product-003",
    jobTitle: "Product Manager",
    companyName: "TechVision",
    status: "REJECTED",
    version: 6,
    createdAt: baseAt(-8),
    lastRejectedAt: baseAt(-1),
    hasCv: true,
    notes: "Thiếu kinh nghiệm dẫn dắt roadmap 2 năm trở lên.",
  },
];

export const offers: Offer[] = [
  {
    id: "offer-001",
    applicationId: "app-003",
    candidateName: "Vu Nguyen",
    jobTitle: "AI Engineer",
    salary: "35.000.000 VNĐ/tháng",
    offerVersion: 1,
    applicationVersion: 4,
    expiresAt: baseAt(10),
    status: "PENDING_CANDIDATE_RESPONSE",
    fileId: "f-offer-doc-001",
    fileUrl: "/placeholder-offer.png",
  },
];

export const myApplicationVersionMap: Record<string, number> = {
  "app-001": 3,
  "app-002": 1,
  "app-003": 4,
  "app-004": 6,
};

export const jobStatuses = {
  DRAFT: ["Gửi duyệt"],
  PENDING_APPROVAL: ["Chờ xét duyệt", "Sửa lại"],
  PUBLISHED: ["Đóng tin", "Sửa nội dung", "Xem pipeline"],
  CLOSED: ["Mở lại", "Xem pipeline"],
  EXPIRED: ["Cập nhật deadline", "Mở lại"],
} as const;

export const applicationStatusTransitions: Record<ApplicationStatus, string[]> = {
  APPLIED: ["REVIEWING", "WITHDRAWN", "REJECTED"],
  REVIEWING: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["HIRED", "REJECTED", "WITHDRAWN"],
  HIRED: [],
  REJECTED: ["APPLIED (sau 30 ngày cooldown)"],
  WITHDRAWN: ["APPLIED (nếu còn hạn theo hệ thống)", "CHÚ Ý: cần mở phiên mới"],
};

export async function getCompany() {
  return wrapSuccess(companies[0]);
}

export async function getPublicJobs(search: {
  q?: string;
  mode: SearchMode;
  page?: number;
  limit?: number;
  cursor?: string | null;
  source?: "ELASTICSEARCH" | "POSTGRESQL" | "";
}) {
  const keyword = (search.q || "").toLowerCase();
  const allowedSource = search.source ? (search.source as JobDataSource) : undefined;

  const list = jobs
    .filter((item) => item.status === "PUBLISHED")
    .filter((item) => {
      const matchKeyword =
        item.title.toLowerCase().includes(keyword) ||
        item.location.toLowerCase().includes(keyword) ||
        item.department.toLowerCase().includes(keyword);
      const matchSource = allowedSource ? item.source === allowedSource : true;
      return matchKeyword && matchSource;
    })
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));

  if (search.mode === "OFFSET") {
    const page = Math.max(search.page || 1, 1);
    const limit = Math.max(search.limit || 10, 1);
    const start = (page - 1) * limit;
    const sliced = list.slice(start, start + limit);
    return wrapSuccess(sliced, {
      page,
      limit,
      total: list.length,
      hasMore: start + limit < list.length,
    });
  }

  const cursor = Number(search.cursor || 0);
  const limit = Math.max(search.limit || 10, 1);
  const safeCursor = Number.isNaN(cursor) ? 0 : cursor;
  const sliced = list.slice(safeCursor, safeCursor + limit);
  const next = safeCursor + sliced.length;

  return wrapSuccess(sliced, {
    cursor: String(safeCursor),
    nextCursor: next < list.length ? String(next) : null,
    hasMore: next < list.length,
    limit,
    source: "CURSOR",
  });
}

export async function getPublicJob(id: string) {
  return wrapSuccess(jobs.find((item) => item.id === id) || null);
}

export async function getRecruiterJobs() {
  return wrapSuccess(jobs);
}

export async function getApplications(candidateId?: string) {
  const filtered = candidateId ? applications.filter((item) => item.candidateId === candidateId) : applications;
  return wrapSuccess(filtered);
}

export async function getApplicationsByJob(jobId: string) {
  return wrapSuccess(applications.filter((item) => item.jobId === jobId));
}

export async function getRecommendationsForCandidate() {
  return wrapSuccess(jobRecommendations);
}

export async function getOffer(id: string) {
  return wrapSuccess(offers.find((item) => item.id === id) || null);
}
