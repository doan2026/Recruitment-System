import {
  API_PATHS,
  ApiClientError,
  type ApiEnvelope,
  assertCanonicalUuidV4,
  getApiSessionAccountId,
  requestApi,
  selectContractFields,
} from "./apiClient";
import type { CompanyCreateValues } from "./companyForm";
import type { RecruiterJobPayload } from "./jobForm";
import type { PublicJobSearchFilters } from "./publicJobSearch";
import type {
  CompanyMediaAssetType,
  CompanyMediaUploadCapability,
  CompanyMediaUploadResult,
} from "./companyMediaUpload";
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
  media?: Array<{ fileId: string; url: string; type: "IMAGE" | "VIDEO"; sortOrder: number }>;
  verifiedStatus: Company["verificationStatus"];
  rejectReason?: string | null;
  aggregateVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicCompanySummary {
  id: string;
  name: string;
  slug: string;
  industry: string;
  size: string;
  address: string;
  logoUrl: string | null;
}

export interface PublicCompanyMedia {
  url: string;
  type: "IMAGE" | "VIDEO";
  sortOrder: number;
}

export interface PublicCompanyProfile {
  id: string;
  name: string;
  slug: string;
  description: string;
  industry: string;
  size: string;
  address: string;
  website: string | null;
  taxCode: string;
  logoUrl: string | null;
  media: PublicCompanyMedia[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatedCompanyInvitation {
  id: string;
  companyId: string;
  email: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  expiresAt: string;
  createdAt: string;
  invitationToken: string;
}

export interface RecruiterCompanyMembership {
  companyId: string;
  name: string;
  verifiedStatus: Company["verificationStatus"];
  memberRole: "OWNER" | "MEMBER";
}

export type CompanyMemberRole = "OWNER" | "MEMBER";

export interface CompanyMember {
  userId: string;
  role: CompanyMemberRole;
  joinedAt: string;
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
  experienceYears: number;
  quantity: number;
  skills: string[];
  deadline: string;
  status?: Job["status"];
  rejectionReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type RecruiterJobUpdateInput = RecruiterJobPayload;

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

let demoMembershipRole: CompanyMemberRole = "OWNER";

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
      gallery: (value.media ?? []).map((item, index) => ({
        fileId: item.fileId,
        url: item.url,
        type: item.type,
        sortOrder: item.sortOrder ?? index,
      })),
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
    experienceYears: value.experienceYears,
    quantity: value.quantity,
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
    rejectionReason: value.rejectionReason ?? undefined,
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

export async function resubmitCompanyVerification(
  signal?: AbortSignal,
): Promise<ApiEnvelope<Company>> {
  if (isDemoPerson2Api) {
    const current = (await normalizeDemo(demo.getCompany())).data;
    return {
      data: {
        ...current,
        verificationStatus: "PENDING",
        rejectReason: undefined,
        aggregateVersion: current.aggregateVersion + 1,
        updatedAt: new Date().toISOString(),
      },
      meta: null,
    };
  }

  const response = await requestApi<BackendCompany>(`${API_PATHS.companyMine}/submit-verification`, {
    method: "POST",
    privateData: true,
    signal,
    maxRetries: 0,
  });
  return { ...response, data: toCompany(response.data) };
}

export async function createCompany(
  input: Omit<CompanyCreateValues, "website"> & { website?: string },
  signal?: AbortSignal,
): Promise<ApiEnvelope<Company>> {
  const body = selectContractFields({
    name: input.name,
    description: input.description,
    industry: input.industry,
    size: input.size,
    address: input.address,
    website: input.website,
    taxCode: input.taxCode,
  }, ["name", "description", "industry", "size", "address", "website", "taxCode"]);

  if (isDemoPerson2Api) {
    const current = (await normalizeDemo(demo.getCompany())).data;
    return {
      data: {
        ...current,
        name: input.name,
        shortName: input.name,
        taxCode: input.taxCode,
        verificationStatus: "PENDING",
        rejectReason: undefined,
        aggregateVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      meta: null,
    };
  }

  const response = await requestApi<BackendCompany>(API_PATHS.companies, {
    method: "POST",
    privateData: true,
    signal,
    body,
    maxRetries: 0,
  });
  return { ...response, data: toCompany(response.data) };
}

export async function createCompanyMediaUploadIntent(
  companyId: string,
  type: CompanyMediaAssetType,
  originalFilename: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<CompanyMediaUploadCapability>> {
  if (isDemoPerson2Api) {
    return {
      data: {
        fileId: crypto.randomUUID().toLowerCase(),
        uploadUrl: "https://api.cloudinary.example/upload",
        cloudName: "demo",
        apiKey: "demo-public-key",
        resourceType: type === "COMPANY_VIDEO" ? "video" : "image",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        maxBytes: type === "COMPANY_LOGO" ? 2 * 1024 * 1024 : type === "COMPANY_IMAGE" ? 5 * 1024 * 1024 : 50 * 1024 * 1024,
        allowedFormats: type === "COMPANY_VIDEO" ? ["mp4"] : ["jpg", "png", "webp"],
        params: {},
        signature: "demo-signature",
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(companyId, "companyId");
  return requestApi<CompanyMediaUploadCapability>(`${API_PATHS.companies}${companyId}/media/signature`, {
    method: "POST",
    privateData: true,
    signal,
    headers: { "Idempotency-Key": idempotencyKey },
    body: selectContractFields({ type, originalFilename }, ["type", "originalFilename"]),
    maxRetries: 0,
  });
}

export async function confirmCompanyMediaUpload(
  companyId: string,
  fileId: string,
  type: CompanyMediaAssetType,
  signal?: AbortSignal,
): Promise<ApiEnvelope<CompanyMediaUploadResult>> {
  if (isDemoPerson2Api) return {
    data: { fileId, type, url: "/placeholder-company.png" },
    meta: null,
  };
  assertCanonicalUuidV4(companyId, "companyId");
  assertCanonicalUuidV4(fileId, "fileId");
  return requestApi<CompanyMediaUploadResult>(`${API_PATHS.companies}${companyId}/media/confirm`, {
    method: "POST",
    privateData: true,
    signal,
    body: selectContractFields({ fileId, type }, ["fileId", "type"]),
    maxRetries: 0,
  });
}

export interface UpdateCompanyInput {
  name?: string;
  taxCode?: string;
  logo?: { fileId: string };
  media?: Array<{ fileId: string; type: "IMAGE" | "VIDEO"; sortOrder: number }>;
  removeLogo?: boolean;
}

export async function updateCompany(
  id: string,
  input: UpdateCompanyInput,
  signal?: AbortSignal,
): Promise<ApiEnvelope<Company>> {
  const body = selectContractFields({
    name: input.name,
    taxCode: input.taxCode,
    logo: input.logo,
    media: input.media,
    removeLogo: input.removeLogo,
  }, ["name", "taxCode", "logo", "media", "removeLogo"]);
  if (isDemoPerson2Api) {
    const current = (await normalizeDemo(demo.getCompany())).data;
    const nameChanged = body.name !== undefined && body.name !== current.name;
    const taxCodeChanged = body.taxCode !== undefined && body.taxCode !== current.taxCode;
    const needsReview = current.verificationStatus === "VERIFIED" && (nameChanged || taxCodeChanged);
    return {
      data: {
        ...current,
        name: typeof body.name === "string" ? body.name : current.name,
        taxCode: typeof body.taxCode === "string" ? body.taxCode : current.taxCode,
        media: {
          logo: body.removeLogo ? undefined : body.logo ? {
            fileId: body.logo.fileId,
            url: "/placeholder-company.png",
          } : current.media.logo,
          gallery: body.media ? body.media.map((item) => ({
            ...item,
            url: item.type === "VIDEO" ? "/placeholder-company-video.mp4" : "/placeholder-office-1.png",
          })) : current.media.gallery,
        },
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

export async function searchPublicCompanies(search: {
  q?: string;
  limit: number;
  cursor?: string | null;
}, signal?: AbortSignal): Promise<ApiEnvelope<PublicCompanySummary[]>> {
  if (isDemoPerson2Api) {
    const normalized = search.q?.trim().toLocaleLowerCase("vi-VN") ?? "";
    const items = demo.companies
      .filter((company) => !normalized || company.name.toLocaleLowerCase("vi-VN").includes(normalized))
      .slice(0, search.limit)
      .map((company) => ({
        id: company.id, name: company.name, slug: company.shortName,
        industry: "Công nghệ", size: "51-200", address: "Hà Nội",
        logoUrl: null,
      }));
    return { data: items, meta: { limit: search.limit, hasMore: false, nextCursor: null } };
  }
  return requestApi<PublicCompanySummary[]>(API_PATHS.companySearch, {
    signal,
    query: { q: search.q, limit: search.limit, cursor: search.cursor },
    allowedQueryKeys: ["q", "limit", "cursor"],
  });
}

export async function getPublicCompany(
  id: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<PublicCompanyProfile | null>> {
  if (isDemoPerson2Api) {
    const company = demo.companies.find((item) => item.id === id);
    if (!company) return { data: null, meta: null };
    return {
      data: {
        id: company.id,
        name: company.name,
        slug: company.shortName,
        description: "Môi trường sản phẩm chú trọng chất lượng trải nghiệm và phát triển nghề nghiệp bền vững.",
        industry: "Công nghệ",
        size: "51-200",
        address: "Hà Nội",
        website: null,
        taxCode: company.taxCode,
        logoUrl: null,
        media: [],
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(id, "companyId");
  return requestApi<PublicCompanyProfile>(`${API_PATHS.companies}${id}`, { signal });
}

export async function inviteCompanyMember(
  companyId: string,
  email: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<CreatedCompanyInvitation>> {
  if (isDemoPerson2Api) {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 7);
    return {
      data: {
        id: `demo-invitation-${now.getTime()}`,
        companyId,
        email,
        status: "PENDING",
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
        invitationToken: `demo-token-${now.getTime()}-copy-this-value`,
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(companyId, "companyId");
  const body = selectContractFields({ email }, ["email"] as const);
  return requestApi<CreatedCompanyInvitation>(`${API_PATHS.companies}${companyId}/members`, {
    method: "POST",
    privateData: true,
    signal,
    body,
    maxRetries: 0,
  });
}

export async function acceptCompanyInvitation(
  token: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<RecruiterCompanyMembership>> {
  if (isDemoPerson2Api) {
    return {
      data: {
        companyId: demo.companies[0]?.id ?? "demo-company",
        name: demo.companies[0]?.name ?? "Doanh nghiệp demo",
        verifiedStatus: demo.companies[0]?.verificationStatus ?? "PENDING",
        memberRole: "MEMBER",
      },
      meta: null,
    };
  }
  const body = selectContractFields({ token }, ["token"] as const);
  return requestApi<RecruiterCompanyMembership>(`${API_PATHS.companies}invitations/accept`, {
    method: "POST",
    privateData: true,
    signal,
    body,
    maxRetries: 0,
  });
}

export async function getCurrentCompanyMembership(
  signal?: AbortSignal,
): Promise<ApiEnvelope<RecruiterCompanyMembership>> {
  if (isDemoPerson2Api) {
    const company = demo.companies[0];
    return {
      data: {
        companyId: company?.id ?? "demo-company",
        name: company?.name ?? "Doanh nghiệp demo",
        verifiedStatus: company?.verificationStatus ?? "PENDING",
        memberRole: demoMembershipRole,
      },
      meta: null,
    };
  }
  const accountId = getApiSessionAccountId();
  if (!accountId) throw new ApiClientError({ code: "SESSION_ACCOUNT_REQUIRED", status: 401 });
  assertCanonicalUuidV4(accountId, "accountId");
  return requestApi<RecruiterCompanyMembership>(`${API_PATHS.companies}by-user/${accountId}`, {
    privateData: true,
    signal,
  });
}

export async function getCompanyMembers(
  companyId: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<CompanyMember[]>> {
  if (isDemoPerson2Api) {
    return {
      data: [
        { userId: "demo-owner", role: demoMembershipRole, joinedAt: new Date(2025, 0, 8).toISOString() },
        { userId: "demo-member", role: demoMembershipRole === "OWNER" ? "MEMBER" : "OWNER", joinedAt: new Date(2025, 4, 12).toISOString() },
      ],
      meta: null,
    };
  }
  assertCanonicalUuidV4(companyId, "companyId");
  return requestApi<CompanyMember[]>(`${API_PATHS.companies}${companyId}/members`, {
    privateData: true,
    signal,
  });
}

export async function transferCompanyOwnership(
  companyId: string,
  targetUserId: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<CompanyMember[]>> {
  if (isDemoPerson2Api) {
    demoMembershipRole = "MEMBER";
    return getCompanyMembers(companyId, signal);
  }
  assertCanonicalUuidV4(companyId, "companyId");
  assertCanonicalUuidV4(targetUserId, "userId");
  return requestApi<CompanyMember[]>(`${API_PATHS.companies}${companyId}/members/${targetUserId}/transfer-ownership`, {
    method: "PATCH",
    privateData: true,
    signal,
    maxRetries: 0,
  });
}

export async function removeCompanyMember(
  companyId: string,
  targetUserId: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<{ removedUserId: string }>> {
  if (isDemoPerson2Api) return { data: { removedUserId: targetUserId }, meta: null };
  assertCanonicalUuidV4(companyId, "companyId");
  assertCanonicalUuidV4(targetUserId, "userId");
  return requestApi<{ removedUserId: string }>(`${API_PATHS.companies}${companyId}/members/${targetUserId}`, {
    method: "DELETE",
    privateData: true,
    signal,
    maxRetries: 0,
  });
}

export interface PublicJobSearchRequest extends PublicJobSearchFilters {
  mode: SearchMode;
  page?: number;
  limit?: number;
  cursor?: string | null;
  source?: JobDataSource | "";
}

export async function getPublicJobs(search: PublicJobSearchRequest, signal?: AbortSignal): Promise<ApiEnvelope<Job[]>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getPublicJobs(search));
  const response = await requestApi<JobSearchResult>(API_PATHS.jobSearch, {
    signal,
    query: {
      q: search.q,
      location: search.location,
      salaryMin: search.salaryMin,
      salaryMax: search.salaryMax,
      skills: search.skills,
      experienceYears: search.experienceYears,
      jobType: search.jobType,
      sort: search.sort,
      pagination: search.mode,
      page: search.mode === "OFFSET" ? search.page : undefined,
      limit: search.limit,
      cursor: search.mode === "CURSOR" ? search.cursor : undefined,
    },
    allowedQueryKeys: ["q", "location", "salaryMin", "salaryMax", "skills", "experienceYears", "jobType", "sort", "pagination", "page", "limit", "cursor"],
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

export async function createRecruiterJob(
  values: RecruiterJobPayload,
  signal?: AbortSignal,
): Promise<ApiEnvelope<Job>> {
  if (isDemoPerson2Api) {
    const now = new Date().toISOString();
    return {
      data: {
        id: `job-draft-${Date.now()}`,
        companyId: "cmp-techvision",
        title: values.title,
        level: `${values.experienceYears}+ năm`,
        experienceYears: values.experienceYears,
        quantity: values.quantity,
        type: values.jobType === "FULL_TIME" ? "FULLTIME" : values.jobType === "PART_TIME" ? "PARTTIME" : "CONTRACT",
        location: values.location,
        department: "Chưa phân loại",
        salaryMin: values.salaryMin ?? 0,
        salaryMax: values.salaryMax ?? null,
        currency: "VND",
        isNegotiable: values.isNegotiable,
        description: values.description,
        requirements: toList(values.requirements),
        responsibilities: [],
        benefits: toList(values.benefits),
        skills: values.skills,
        status: "DRAFT",
        deadline: values.deadline,
        source: "POSTGRESQL",
        ownerName: "Nhà tuyển dụng",
        aggregateVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
      meta: null,
    };
  }
  const body = selectContractFields(values as unknown as Record<string, unknown>, [
    "title", "description", "requirements", "benefits", "salaryMin", "salaryMax",
    "isNegotiable", "currency", "location", "jobType", "experienceYears", "quantity", "skills", "deadline",
  ]);
  const response = await requestApi<BackendJob>(API_PATHS.jobs, {
    method: "POST",
    body,
    privateData: true,
    signal,
    maxRetries: 0,
  });
  return { ...response, data: toJob(response.data) };
}

export async function getRecruiterJob(jobId: string, signal?: AbortSignal): Promise<ApiEnvelope<Job>> {
  if (!isDemoPerson2Api) assertCanonicalUuidV4(jobId, "jobId");
  const response = await getRecruiterJobs(signal);
  const job = response.data.find((item) => item.id === jobId);
  if (!job) throw new ApiClientError({ code: "JOB_NOT_FOUND", status: 404 });
  return { ...response, data: job };
}

export async function updateRecruiterJob(
  jobId: string,
  values: RecruiterJobUpdateInput,
  signal?: AbortSignal,
): Promise<ApiEnvelope<Job>> {
  if (isDemoPerson2Api) {
    const job = demo.jobs.find((item) => item.id === jobId);
    if (!job) throw new ApiClientError({ code: "JOB_NOT_FOUND", status: 404 });
    return {
      data: {
        ...job,
        title: values.title,
        level: `${values.experienceYears}+ năm`,
        experienceYears: values.experienceYears,
        quantity: values.quantity,
        description: values.description,
        requirements: toList(values.requirements),
        benefits: toList(values.benefits),
        salaryMin: values.salaryMin ?? 0,
        salaryMax: values.salaryMax ?? null,
        isNegotiable: values.isNegotiable,
        location: values.location,
        type: values.jobType === "FULL_TIME" ? "FULLTIME" : values.jobType === "PART_TIME" ? "PARTTIME" : "CONTRACT",
        skills: values.skills,
        deadline: values.deadline,
        updatedAt: new Date().toISOString(),
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(jobId, "jobId");
  const body = selectContractFields(values as unknown as Record<string, unknown>, [
    "title", "description", "requirements", "benefits", "salaryMin", "salaryMax",
    "isNegotiable", "currency", "location", "jobType", "experienceYears", "quantity", "skills", "deadline",
  ]);
  const response = await requestApi<BackendJob>(`${API_PATHS.jobs}${jobId}`, {
    method: "PUT",
    body,
    privateData: true,
    signal,
    maxRetries: 0,
  });
  return { ...response, data: toJob(response.data) };
}

export async function submitJobForApproval(jobId: string, signal?: AbortSignal): Promise<ApiEnvelope<Job>> {
  if (isDemoPerson2Api) {
    const job = demo.jobs.find((item) => item.id === jobId);
    if (!job) throw new ApiClientError({ code: "JOB_NOT_FOUND", status: 404 });
    return { data: { ...job, status: "PENDING_APPROVAL", rejectionReason: undefined }, meta: null };
  }
  assertCanonicalUuidV4(jobId, "jobId");
  const response = await requestApi<BackendJob>(`${API_PATHS.jobs}${jobId}/publish`, {
    method: "PATCH",
    privateData: true,
    signal,
    maxRetries: 0,
  });
  return { ...response, data: toJob(response.data) };
}

export async function closeRecruiterJob(jobId: string, signal?: AbortSignal): Promise<ApiEnvelope<Job>> {
  if (isDemoPerson2Api) {
    const job = demo.jobs.find((item) => item.id === jobId);
    if (!job) throw new ApiClientError({ code: "JOB_NOT_FOUND", status: 404 });
    return { data: { ...job, status: "CLOSED" }, meta: null };
  }
  assertCanonicalUuidV4(jobId, "jobId");
  const response = await requestApi<BackendJob>(`${API_PATHS.jobs}${jobId}/close`, {
    method: "PATCH",
    privateData: true,
    signal,
    maxRetries: 0,
  });
  return { ...response, data: toJob(response.data) };
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
