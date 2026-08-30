import {
  API_PATHS,
  ApiClientError,
  type ApiEnvelope,
  assertCanonicalUuidV4,
  requestApi,
  selectContractFields,
} from "./apiClient";
import * as demo from "./demoData";

export type {
  ApiError,
  ApplicationStatus,
  CandidateApplication,
  Company,
  CompanyVerificationStatus,
  FallbackReason,
  Job,
  JobDataSource,
  JobRecommendation,
  JobStatus,
  Offer,
  OfferStatus,
  RecommendationSource,
  SearchMode,
} from "./demoData";
export { applicationStatusTransitions, jobStatuses } from "./demoData";

import type {
  CandidateApplication,
  Company,
  Job,
  JobDataSource,
  JobRecommendation,
  Offer,
  RecommendationSource,
  SearchMode,
} from "./demoData";

export const person2ApiMode = process.env.NEXT_PUBLIC_API_MODE === "gateway" ? "gateway" : "demo";
export const isDemoPerson2Api = person2ApiMode === "demo";

interface BackendCompany {
  id: string;
  name: string;
  slug?: string;
  taxCode: string;
  logo?: { fileId: string; url: string } | null;
  media?: Array<{ fileId: string; url: string; type?: string }>;
  verifiedStatus: Company["verificationStatus"];
  rejectReason?: string | null;
  aggregateVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface BackendJob {
  id: string;
  companyId: string;
  createdBy?: string;
  companyName?: string | null;
  title: string;
  description: string;
  requirements?: string | string[];
  benefits?: string | string[];
  salaryMin?: string | number | null;
  salaryMax?: string | number | null;
  isNegotiable: boolean;
  currency?: string;
  location: string;
  jobType: string;
  experienceYears?: number;
  skills: string[];
  deadline: string;
  status?: Job["status"];
  createdAt?: string;
  updatedAt?: string;
}

interface JobSearchResult {
  items: BackendJob[];
  total: number;
  page: number;
  limit: number;
  source: JobDataSource;
  nextCursor: string | null;
  hasMore: boolean;
}

interface JobRecommendationResult {
  items: Array<BackendJob & { score: number | null }>;
  nextCursor: string | null;
  source: RecommendationSource;
  fallbackReason: JobRecommendation["fallbackReason"] | null;
}

interface BackendApplicationListItem {
  id: string;
  jobId: string;
  companyId: string;
  candidateId?: string;
  jobTitle: string;
  status: CandidateApplication["status"];
  matchScore?: number | null;
  appliedAt: string;
  updatedAt: string;
  version?: number;
}

async function normalizeDemo<T>(
  response: Promise<{ data: T; meta?: ApiEnvelope<T>["meta"] }>,
): Promise<ApiEnvelope<T>> {
  const envelope = await response;
  return { data: envelope.data, meta: envelope.meta ?? null };
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? value.split("\n").map((item) => item.trim()).filter(Boolean) : [];
}

function toJobType(value: string): Job["type"] {
  if (value === "FULL_TIME") return "FULLTIME";
  if (value === "PART_TIME") return "PARTTIME";
  return "CONTRACT";
}

function toCompany(value: BackendCompany): Company {
  return {
    id: value.id,
    name: value.name,
    shortName: value.slug || value.name,
    taxCode: value.taxCode,
    ownerName: "Đang đồng bộ thành viên",
    aggregateVersion: value.aggregateVersion,
    verificationStatus: value.verifiedStatus,
    rejectReason: value.rejectReason || undefined,
    media: {
      logo: value.logo || undefined,
      gallery: (value.media ?? []).filter((item) => item.type !== "VIDEO"),
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function toJob(value: BackendJob, source: JobDataSource = "POSTGRESQL"): Job {
  return {
    id: value.id,
    companyId: value.companyId,
    title: value.title,
    level: value.experienceYears === undefined ? "Không yêu cầu" : `${value.experienceYears}+ năm`,
    type: toJobType(value.jobType),
    location: value.location,
    department: "Chưa phân loại",
    salaryMin: toNumber(value.salaryMin) ?? 0,
    salaryMax: toNumber(value.salaryMax),
    currency: "VND",
    isNegotiable: value.isNegotiable,
    description: value.description,
    requirements: toList(value.requirements),
    responsibilities: [],
    benefits: toList(value.benefits),
    skills: value.skills,
    status: value.status ?? "PUBLISHED",
    deadline: value.deadline,
    source,
    ownerName: value.createdBy || value.companyName || "Nhà tuyển dụng",
    aggregateVersion: 0,
    createdAt: value.createdAt ?? value.updatedAt ?? new Date(0).toISOString(),
    updatedAt: value.updatedAt ?? value.createdAt ?? new Date(0).toISOString(),
  };
}

function toApplication(value: BackendApplicationListItem): CandidateApplication {
  return {
    id: value.id,
    candidateId: value.candidateId ?? "",
    candidateName: "Ứng viên",
    email: "",
    jobId: value.jobId,
    jobTitle: value.jobTitle,
    companyName: "Doanh nghiệp tuyển dụng",
    status: value.status,
    version: value.version ?? 0,
    matchScore: value.matchScore ?? undefined,
    createdAt: value.appliedAt,
  };
}

export async function getCompany(signal?: AbortSignal): Promise<ApiEnvelope<Company>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getCompany());
  const response = await requestApi<BackendCompany>(API_PATHS.companyMine, { privateData: true, signal });
  return { ...response, data: toCompany(response.data) };
}

export interface UpdateCompanyInput {
  name?: string;
  taxCode?: string;
}

export async function updateCompany(
  id: string,
  input: UpdateCompanyInput,
  signal?: AbortSignal,
): Promise<ApiEnvelope<Company>> {
  const body = selectContractFields({
    name: input.name,
    taxCode: input.taxCode,
  }, ["name", "taxCode"]);
  if (isDemoPerson2Api) {
    const current = (await normalizeDemo(demo.getCompany())).data;
    const nameChanged = body.name !== undefined && body.name !== current.name;
    const taxCodeChanged = body.taxCode !== undefined && body.taxCode !== current.taxCode;
    const needsReview = current.verificationStatus === "VERIFIED" && (nameChanged || taxCodeChanged);
    return {
      data: {
        ...current,
        ...body,
        aggregateVersion: current.aggregateVersion + 1,
        verificationStatus: needsReview ? "PENDING" : current.verificationStatus,
        rejectReason: needsReview ? undefined : current.rejectReason,
        updatedAt: new Date().toISOString(),
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(id, "companyId");
  const response = await requestApi<BackendCompany>(`${API_PATHS.companies}${id}`, {
    method: "PUT",
    privateData: true,
    signal,
    body,
    maxRetries: 0,
  });
  return { ...response, data: toCompany(response.data) };
}

export async function getPublicJobs(search: {
  q?: string;
  mode: SearchMode;
  page?: number;
  limit?: number;
  cursor?: string | null;
  source?: JobDataSource | "";
}, signal?: AbortSignal): Promise<ApiEnvelope<Job[]>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getPublicJobs(search));
  const response = await requestApi<JobSearchResult>(API_PATHS.jobSearch, {
    signal,
    query: {
      q: search.q,
      pagination: search.mode,
      page: search.mode === "OFFSET" ? search.page : undefined,
      limit: search.limit,
      cursor: search.mode === "CURSOR" ? search.cursor : undefined,
    },
    allowedQueryKeys: ["q", "pagination", "page", "limit", "cursor"],
  });
  return {
    data: response.data.items.map((item) => toJob(item, response.data.source)),
    meta: {
      page: response.data.page,
      limit: response.data.limit,
      total: response.data.total,
      source: response.data.source,
      nextCursor: response.data.nextCursor,
      hasMore: response.data.hasMore,
    },
  };
}

export async function getPublicJob(id: string, signal?: AbortSignal): Promise<ApiEnvelope<Job | null>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getPublicJob(id));
  assertCanonicalUuidV4(id, "jobId");
  const response = await requestApi<BackendJob>(`${API_PATHS.jobs}${id}`, { signal });
  return { ...response, data: toJob(response.data) };
}

export async function getRecruiterJobs(signal?: AbortSignal): Promise<ApiEnvelope<Job[]>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getRecruiterJobs());
  const response = await requestApi<BackendJob[]>(API_PATHS.jobMine, { privateData: true, signal });
  return { ...response, data: response.data.map((item) => toJob(item)) };
}

export async function getApplications(candidateId?: string, signal?: AbortSignal): Promise<ApiEnvelope<CandidateApplication[]>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getApplications(candidateId));
  const response = await requestApi<BackendApplicationListItem[]>(API_PATHS.applicationMine, { privateData: true, signal });
  return { ...response, data: response.data.map(toApplication) };
}

export async function getApplicationsByJob(jobId: string, signal?: AbortSignal): Promise<ApiEnvelope<CandidateApplication[]>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getApplicationsByJob(jobId));
  assertCanonicalUuidV4(jobId, "jobId");
  const response = await requestApi<{ items: BackendApplicationListItem[] }>(API_PATHS.applications, {
    privateData: true,
    signal,
    query: { job_id: jobId, page: 1, size: 100 },
    allowedQueryKeys: ["job_id", "page", "size"],
  });
  return { ...response, data: response.data.items.map(toApplication) };
}

export async function getRecommendationsForCandidate(signal?: AbortSignal): Promise<ApiEnvelope<JobRecommendation[]>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getRecommendationsForCandidate());
  const response = await requestApi<JobRecommendationResult>(API_PATHS.jobRecommended, {
    privateData: true,
    signal,
    query: { limit: 10 },
    allowedQueryKeys: ["limit"],
  });
  return {
    data: response.data.items.map((item) => ({
      id: item.id,
      title: item.title,
      matchPercent: Math.round((item.score ?? 0) * 100),
      source: response.data.source,
      fallbackReason: response.data.fallbackReason ?? undefined,
      nextCursor: response.data.nextCursor,
      reasonText: response.data.fallbackReason
        ? `Nguồn dự phòng: ${response.data.fallbackReason}`
        : "Mức độ phù hợp do hệ thống gợi ý.",
    })),
    meta: {
      source: response.data.source,
      nextCursor: response.data.nextCursor,
      hasMore: response.data.source === "AI" && response.data.nextCursor !== null,
    },
  };
}

export async function getOffer(id: string, signal?: AbortSignal): Promise<ApiEnvelope<Offer | null>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getOffer(id));
  assertCanonicalUuidV4(id, "offerId");
  if (signal?.aborted) throw new ApiClientError({ code: "REQUEST_CANCELLED" });
  throw new ApiClientError({ code: "OFFER_READ_UNAVAILABLE", status: 501 });
}
