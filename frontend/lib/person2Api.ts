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
import type { CandidateRecommendationEmptyReason } from "./candidateRecommendation";
import type { RecruiterApplicationQuery } from "./recruiterApplicationTable";
import { APPLICATION_API_ROUTES, applicationResourceRoute, offerResponseRoute, recruiterDashboardRoute } from "./applicationApiRoutes";
import {
  buildApplicationStatusCommand,
  buildApplicationWithdrawCommand,
  buildMatchRefreshCommand,
  buildOfferResponseCommand,
  buildSendOfferCommand,
  type OfferDecision,
  type SendOfferValues,
} from "./applicationVersioning";
import type {
  CompanyMediaAssetType,
  CompanyMediaUploadCapability,
  CompanyMediaUploadResult,
} from "./companyMediaUpload";
import { assertChatResponseSession } from "./aiChatSession";
import { withAiChatSessionLock } from "./aiChatSessionLock";
import { normalizeAiChatMessage } from "./aiChatMessage";
import { normalizeAiChatAnswer } from "./aiChatResponse";
import { PERSON2_AI_PUBLIC_ROUTES, recruiterCandidateRecommendationsRoute } from "./person2AiPublicRoutes";
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

import { person2ApiMode, isDemoPerson2Api } from "./apiMode";
export { person2ApiMode, isDemoPerson2Api } from "./apiMode";

interface BackendCompany {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  industry?: string;
  size?: string;
  address?: string;
  website?: string | null;
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
  aggregateVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type RecruiterJobUpdateInput = RecruiterJobPayload & { expectedVersion: number };

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

export interface RecruiterCandidateRecommendation {
  candidateId: string;
  fullName: string;
  headline: string | null;
  skills: string[];
  score: number;
}

export interface RecruiterCandidateRecommendationResult {
  jobId: string;
  items: RecruiterCandidateRecommendation[];
  nextCursor: string | null;
  reason: CandidateRecommendationEmptyReason | null;
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
  offerId?: string | null;
  coverLetter?: string | null;
  timeline?: CandidateApplication["timeline"];
}

interface BackendRecruiterApplicationPage {
  items: BackendApplicationListItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface ApplicationTransitionResult {
  applicationId: string;
  fromStatus: CandidateApplication["status"];
  toStatus: CandidateApplication["status"];
  updatedAt: string;
  version: number;
}

export interface ApplicationMatchScoreResult {
  applicationId: string;
  matchScore: number;
  version: number;
}

export interface RecruiterApplicationCv {
  cvId: string;
  title: string;
  type: string;
  isDeleted: boolean;
  createdAt: string;
}

export interface RecruiterApplicationCvDownload {
  cvId: string;
  url: string;
  expiresAt: string;
}

export interface ApplicationEvaluationResult {
  id: string;
  applicationId: string;
  evaluatorId: string;
  score: number;
  criteria: Record<string, number>;
  note: string | null;
  createdAt: string;
}

export interface ApplicationOfferMutationResult {
  id: string;
  applicationId: string;
  salary: string | number;
  startDate: string;
  position: string;
  note: string | null;
  fileId: string | null;
  fileUrl: string | null;
  status: "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  sentAt: string;
  expiresAt: string;
  respondedAt: string | null;
  responseNote: string | null;
  version: number;
  applicationStatus: CandidateApplication["status"];
  applicationVersion: number;
}

export interface CandidateBookmarkJob {
  exists: boolean;
  companyId: string | null;
  title: string;
  status: string;
  deadline: string | null;
  acceptingApplications: boolean;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  salaryMin: string | null;
  salaryMax: string | null;
  isNegotiable: boolean | null;
  currency: string | null;
  location: string | null;
  jobType: string | null;
  experienceYears: number | null;
  quantity: number | null;
  skills: string[] | null;
  availabilityReason: string | null;
}

export interface CandidateBookmark {
  id: string;
  jobId: string;
  createdAt: string;
  job: CandidateBookmarkJob | null;
}

export interface RecruiterDashboard {
  companyId: string;
  generatedAt: string;
  range: { from: string; toExclusive: string; granularity: "DAY" | "WEEK" | "MONTH"; timezone: string };
  summary: {
    activeJobs: { count: number | null; available: boolean };
    totalApplications: number;
    hiredApplications: number;
    hiredRatePercent: number;
  };
  statusCounts: Record<string, number>;
  applicationsByJob: Array<{ jobId: string; jobTitle: string; totalApplications: number; statusCounts: Record<string, number> }>;
  funnel: Array<{ status: string; count: number; rateFromPreviousPercent: number | null }>;
  timeSeries: Array<{ bucketStart: string; count: number }>;
  sourceBreakdown: Record<string, number>;
  warnings: Array<{ code: string; message: string }>;
}

interface BackendAiChatReply {
  session_id: string;
  answer: string;
}

export interface AiChatReply {
  sessionId: string;
  answer: string;
}

async function normalizeDemo<T>(
  response: Promise<{ data: T; meta?: ApiEnvelope<T>["meta"] }>,
): Promise<ApiEnvelope<T>> {
  const envelope = await response;
  return { data: envelope.data, meta: envelope.meta ?? null };
}

export async function sendAiChatMessage(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<AiChatReply>> {
  const canonicalSessionId = assertCanonicalUuidV4(sessionId, "session_id");
  const normalizedMessage = normalizeAiChatMessage(message);
  const body = selectContractFields({ session_id: canonicalSessionId, message: normalizedMessage }, ["session_id", "message"]);

  return withAiChatSessionLock(canonicalSessionId, async () => {
    if (isDemoPerson2Api) {
      return {
        data: {
          sessionId: canonicalSessionId,
          answer: "Mình đã nhận câu hỏi. Khi dùng Gateway, câu trả lời này sẽ đến từ AI Service và chỉ thuộc phiên hiện tại.",
        },
        meta: null,
      };
    }

    const response = await requestApi<BackendAiChatReply>(PERSON2_AI_PUBLIC_ROUTES.chat, {
      method: "POST",
      privateData: true,
      signal,
      body,
      maxRetries: 0,
    });
    return {
      ...response,
      data: {
        sessionId: assertChatResponseSession(canonicalSessionId, response.data.session_id),
        answer: normalizeAiChatAnswer(response.data.answer),
      },
    };
  });
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
  if (value === "REMOTE" || value === "INTERNSHIP") return value;
  throw new ApiClientError({ code: "INVALID_API_RESPONSE" });
}

function toCompany(value: BackendCompany): Company {
  return {
    id: value.id,
    name: value.name,
    shortName: value.slug || value.name,
    taxCode: value.taxCode,
    description: value.description,
    industry: value.industry,
    size: value.size,
    address: value.address,
    website: value.website,
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
    currency: value.currency ?? "VND",
    isNegotiable: value.isNegotiable,
    description: value.description,
    requirements: toList(value.requirements),
    requirementsText: typeof value.requirements === "string" ? value.requirements : undefined,
    responsibilities: [],
    benefits: toList(value.benefits),
    benefitsText: typeof value.benefits === "string" ? value.benefits : undefined,
    skills: value.skills,
    status: value.status ?? "PUBLISHED",
    deadline: value.deadline,
    source,
    ownerName: value.companyName || "Nhà tuyển dụng",
    aggregateVersion: value.aggregateVersion ?? 0,
    rejectionReason: value.rejectionReason ?? undefined,
    createdAt: value.createdAt ?? value.updatedAt ?? new Date(0).toISOString(),
    updatedAt: value.updatedAt ?? value.createdAt ?? new Date(0).toISOString(),
    createdBy: value.createdBy,
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
    version: value.version ?? null,
    offerId: value.offerId,
    coverLetter: value.coverLetter,
    timeline: value.timeline,
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
  expectedVersion: number;
  description?: string;
  industry?: string;
  size?: string;
  address?: string;
  website?: string | null;
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
    expectedVersion: input.expectedVersion,
    description: input.description,
    industry: input.industry,
    size: input.size,
    address: input.address,
    website: input.website,
    name: input.name,
    taxCode: input.taxCode,
    logo: input.logo,
    media: input.media,
    removeLogo: input.removeLogo,
  }, ["expectedVersion", "description", "industry", "size", "address", "website", "name", "taxCode", "logo", "media", "removeLogo"]);
  if (isDemoPerson2Api) {
    const current = (await normalizeDemo(demo.getCompany())).data;
    if (input.expectedVersion !== current.aggregateVersion) throw new ApiClientError({ code: "COMPANY_UPDATE_CONFLICT", status: 409 });
    const nameChanged = body.name !== undefined && body.name !== current.name;
    const taxCodeChanged = body.taxCode !== undefined && body.taxCode !== current.taxCode;
    const needsReview = current.verificationStatus === "VERIFIED" && (nameChanged || taxCodeChanged);
    return {
      data: {
        ...current,
        description: input.description ?? current.description,
        industry: input.industry ?? current.industry,
        size: input.size ?? current.size,
        address: input.address ?? current.address,
        website: input.website === undefined ? current.website : input.website,
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
  companyId?: string;
  mode: SearchMode;
  page?: number;
  limit?: number;
  cursor?: string | null;
  source?: JobDataSource | "";
}

export async function getPublicJobs(search: PublicJobSearchRequest, signal?: AbortSignal): Promise<ApiEnvelope<Job[]>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getPublicJobs(search));
  if (search.companyId) assertCanonicalUuidV4(search.companyId, "companyId");
  const response = await requestApi<JobSearchResult>(API_PATHS.jobSearch, {
    signal,
    query: {
      q: search.q,
      location: search.location,
      companyId: search.companyId,
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
    allowedQueryKeys: ["q", "location", "companyId", "salaryMin", "salaryMax", "skills", "experienceYears", "jobType", "sort", "pagination", "page", "limit", "cursor"],
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
        type: toJobType(values.jobType),
        location: values.location,
        department: "Chưa phân loại",
        salaryMin: values.salaryMin ?? 0,
        salaryMax: values.salaryMax ?? null,
        currency: values.currency,
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
        type: toJobType(values.jobType),
        skills: values.skills,
        deadline: values.deadline,
        currency: values.currency,
        aggregateVersion: values.expectedVersion + 1,
        updatedAt: new Date().toISOString(),
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(jobId, "jobId");
  const body = selectContractFields(values as unknown as Record<string, unknown>, [
    "expectedVersion", "title", "description", "requirements", "benefits", "salaryMin", "salaryMax",
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

export async function getCandidateBookmarks(signal?: AbortSignal): Promise<ApiEnvelope<CandidateBookmark[]>> {
  if (isDemoPerson2Api) {
    const job = demo.jobs[0];
    return {
      data: [
        {
          id: "bookmark-demo-ready",
          jobId: job.id,
          createdAt: new Date().toISOString(),
          job: {
            exists: true,
            companyId: job.companyId,
            title: job.title,
            status: job.status,
            deadline: job.deadline,
            acceptingApplications: job.status === "PUBLISHED",
            description: job.description,
            requirements: job.requirements.join("\n"),
            benefits: job.benefits.join("\n"),
            salaryMin: String(job.salaryMin),
            salaryMax: job.salaryMax === null ? null : String(job.salaryMax),
            isNegotiable: job.isNegotiable,
            currency: job.currency,
            location: job.location,
            jobType: job.type,
            experienceYears: job.experienceYears ?? null,
            quantity: job.quantity ?? null,
            skills: job.skills,
            availabilityReason: null,
          },
        },
        {
          id: "bookmark-demo-degraded",
          jobId: "job-service-temporarily-unavailable",
          createdAt: new Date(Date.now() - 86_400_000).toISOString(),
          job: null,
        },
      ],
      meta: null,
    };
  }
  return requestApi<CandidateBookmark[]>(APPLICATION_API_ROUTES.bookmarks, {
    privateData: true,
    signal,
  });
}

export async function getRecruiterDashboard(
  companyId: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<RecruiterDashboard>> {
  if (isDemoPerson2Api) {
    const statusCounts = demo.applications.reduce<Record<string, number>>((counts, application) => {
      counts[application.status] = (counts[application.status] ?? 0) + 1;
      return counts;
    }, {});
    const totalApplications = demo.applications.length;
    const hiredApplications = statusCounts.HIRED ?? 0;
    const now = new Date();
    return {
      data: {
        companyId,
        generatedAt: now.toISOString(),
        range: {
          from: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
          toExclusive: now.toISOString(),
          granularity: "DAY",
          timezone: "Asia/Ho_Chi_Minh",
        },
        summary: {
          activeJobs: { count: null, available: false },
          totalApplications,
          hiredApplications,
          hiredRatePercent: totalApplications === 0 ? 0 : Number(((hiredApplications / totalApplications) * 100).toFixed(2)),
        },
        statusCounts,
        applicationsByJob: demo.jobs.slice(0, 3).map((job) => {
          const applications = demo.applications.filter((application) => application.jobId === job.id);
          return {
            jobId: job.id,
            jobTitle: job.title,
            totalApplications: applications.length,
            statusCounts: applications.reduce<Record<string, number>>((counts, application) => {
              counts[application.status] = (counts[application.status] ?? 0) + 1;
              return counts;
            }, {}),
          };
        }),
        funnel: Object.entries(statusCounts).map(([status, count]) => ({ status, count, rateFromPreviousPercent: null })),
        timeSeries: [],
        sourceBreakdown: { SEARCH: totalApplications },
        warnings: [{ code: "JOB_SERVICE_UNAVAILABLE", message: "raw downstream message must not be rendered" }],
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(companyId, "company_id");
  return requestApi<RecruiterDashboard>(recruiterDashboardRoute(), {
    query: { company_id: companyId },
    allowedQueryKeys: ["company_id"],
    privateData: true,
    signal,
  });
}

export async function getApplications(candidateId?: string, signal?: AbortSignal): Promise<ApiEnvelope<CandidateApplication[]>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getApplications(candidateId));
  const response = await requestApi<BackendApplicationListItem[]>(API_PATHS.applicationMine, { privateData: true, signal });
  return { ...response, data: response.data.map(toApplication) };
}

export async function submitCandidateApplication(
  values: {
    jobId: string;
    cvId: string;
    coverLetter?: string;
    source: "SEARCH" | "AI_RECOMMENDATION" | "COMPANY_PAGE" | "SHARED_LINK" | "OTHER";
  },
  signal?: AbortSignal,
): Promise<ApiEnvelope<CandidateApplication>> {
  if (isDemoPerson2Api) {
    const job = demo.jobs.find((item) => item.id === values.jobId);
    if (!job) throw new ApiClientError({ code: "JOB_NOT_FOUND", status: 404 });
    const now = new Date().toISOString();
    return {
      data: {
        id: `application-${Date.now()}`,
        candidateId: "demo-candidate",
        candidateName: "Ứng viên demo",
        email: "",
        jobId: values.jobId,
        jobTitle: job.title,
        companyName: "Doanh nghiệp tuyển dụng",
        status: "APPLIED",
        version: 0,
        createdAt: now,
        hasCv: true,
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(values.jobId, "jobId");
  assertCanonicalUuidV4(values.cvId, "cvId");
  const body = selectContractFields({
    jobId: values.jobId,
    cvId: values.cvId,
    coverLetter: values.coverLetter?.trim() || undefined,
    source: values.source,
  }, ["jobId", "cvId", "coverLetter", "source"] as const);
  const response = await requestApi<BackendApplicationListItem>(APPLICATION_API_ROUTES.collection, {
    method: "POST",
    body,
    privateData: true,
    signal,
    maxRetries: 0,
  });
  return { ...response, data: toApplication(response.data) };
}

export async function getRecruiterApplications(
  query: RecruiterApplicationQuery,
  signal?: AbortSignal,
): Promise<ApiEnvelope<CandidateApplication[]>> {
  if (isDemoPerson2Api) {
    let items = [...demo.applications];
    if (query.jobId) items = items.filter((item) => item.jobId === query.jobId);
    if (query.status) items = items.filter((item) => item.status === query.status);
    if (query.appliedFrom) items = items.filter((item) => Date.parse(item.createdAt) >= Date.parse(query.appliedFrom!));
    if (query.appliedTo) items = items.filter((item) => Date.parse(item.createdAt) <= Date.parse(query.appliedTo!));
    items.sort((left, right) => query.sort === "APPLIED_AT_ASC"
      ? left.createdAt.localeCompare(right.createdAt)
      : query.sort === "MATCH_SCORE_DESC"
        ? (right.matchScore ?? -1) - (left.matchScore ?? -1)
        : right.createdAt.localeCompare(left.createdAt));
    const start = query.page * query.size;
    const pageItems = items.slice(start, start + query.size);
    return { data: pageItems, meta: { page: query.page, size: query.size, total: items.length, totalPages: Math.ceil(items.length / query.size) } };
  }
  if (query.jobId) assertCanonicalUuidV4(query.jobId, "jobId");
  const response = await requestApi<BackendRecruiterApplicationPage>(APPLICATION_API_ROUTES.collection, {
    privateData: true,
    signal,
    query: {
      job_id: query.jobId,
      status: query.status,
      appliedFrom: query.appliedFrom,
      appliedTo: query.appliedTo,
      skills: query.skills,
      sort: query.sort,
      page: query.page,
      size: query.size,
    },
    allowedQueryKeys: ["job_id", "status", "appliedFrom", "appliedTo", "skills", "sort", "page", "size"],
  });
  return {
    data: response.data.items.map(toApplication),
    meta: { page: response.data.page, size: response.data.size, total: response.data.totalElements, totalPages: response.data.totalPages },
  };
}

export async function getApplicationsByJob(jobId: string, signal?: AbortSignal): Promise<ApiEnvelope<CandidateApplication[]>> {
  return getRecruiterApplications({ jobId, sort: "APPLIED_AT_DESC", page: 0, size: 100 }, signal);
}

export async function getApplicationDetail(
  applicationId: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<CandidateApplication>> {
  if (isDemoPerson2Api) {
    const application = demo.applications.find((item) => item.id === applicationId);
    if (!application) throw new ApiClientError({ code: "APPLICATION_NOT_FOUND", status: 404 });
    return { data: application, meta: null };
  }
  assertCanonicalUuidV4(applicationId, "applicationId");
  const response = await requestApi<BackendApplicationListItem>(
    applicationResourceRoute(applicationId),
    { privateData: true, signal },
  );
  return { ...response, data: toApplication(response.data) };
}

export async function getRecruiterApplicationCv(
  applicationId: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<RecruiterApplicationCv>> {
  if (isDemoPerson2Api) {
    return {
      data: {
        cvId: "018f47a2-6f4d-4b7d-8c91-ff02d770a944",
        title: "CV ứng tuyển đã chốt",
        type: "UPLOAD",
        isDeleted: false,
        createdAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(applicationId, "applicationId");
  return requestApi<RecruiterApplicationCv>(applicationResourceRoute(applicationId, "cv"), {
    privateData: true,
    signal,
  });
}

export async function createRecruiterCvDownload(
  applicationId: string,
  signal?: AbortSignal,
): Promise<ApiEnvelope<RecruiterApplicationCvDownload>> {
  if (isDemoPerson2Api) {
    return {
      data: {
        cvId: "018f47a2-6f4d-4b7d-8c91-ff02d770a944",
        url: "https://example.com/demo-cv.pdf",
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(applicationId, "applicationId");
  return requestApi<RecruiterApplicationCvDownload>(applicationResourceRoute(applicationId, "cv/download-url"), {
    method: "POST",
    privateData: true,
    signal,
    maxRetries: 0,
  });
}

export async function createApplicationEvaluation(
  applicationId: string,
  input: { score: number; criteria: Record<string, number>; note?: string },
  signal?: AbortSignal,
): Promise<ApiEnvelope<ApplicationEvaluationResult>> {
  const body = selectContractFields({
    score: input.score,
    criteria: input.criteria,
    note: input.note,
  }, ["score", "criteria", "note"]);
  if (isDemoPerson2Api) {
    return {
      data: {
        id: crypto.randomUUID().toLowerCase(),
        applicationId,
        evaluatorId: "018f47a2-6f4d-4b7d-8c91-ff02d770a944",
        score: input.score,
        criteria: input.criteria,
        note: input.note ?? null,
        createdAt: new Date().toISOString(),
      },
      meta: null,
    };
  }
  assertCanonicalUuidV4(applicationId, "applicationId");
  return requestApi<ApplicationEvaluationResult>(applicationResourceRoute(applicationId, "evaluation"), {
    method: "POST",
    body,
    privateData: true,
    signal,
    maxRetries: 0,
  });
}

export async function changeApplicationStatus(
  applicationId: string,
  input: { status: CandidateApplication["status"]; note?: string; applicationVersion: number },
  signal?: AbortSignal,
): Promise<ApiEnvelope<ApplicationTransitionResult>> {
  const body = buildApplicationStatusCommand(input);
  if (isDemoPerson2Api) {
    const application = demo.applications.find((item) => item.id === applicationId);
    if (!application) throw new ApiClientError({ code: "APPLICATION_NOT_FOUND", status: 404 });
    return { data: { applicationId, fromStatus: application.status, toStatus: input.status, updatedAt: new Date().toISOString(), version: body.expectedVersion + 1 }, meta: null };
  }
  assertCanonicalUuidV4(applicationId, "applicationId");
  return requestApi<ApplicationTransitionResult>(applicationResourceRoute(applicationId, "status"), {
    method: "PATCH",
    body,
    privateData: true,
    signal,
    maxRetries: 0,
  });
}

export async function withdrawCandidateApplication(
  applicationId: string,
  input: { note?: string; applicationVersion: number },
  signal?: AbortSignal,
): Promise<ApiEnvelope<ApplicationTransitionResult>> {
  const body = buildApplicationWithdrawCommand(input);
  if (isDemoPerson2Api) {
    const application = demo.applications.find((item) => item.id === applicationId);
    if (!application) throw new ApiClientError({ code: "APPLICATION_NOT_FOUND", status: 404 });
    return { data: { applicationId, fromStatus: application.status, toStatus: "WITHDRAWN", updatedAt: new Date().toISOString(), version: body.expectedVersion + 1 }, meta: null };
  }
  assertCanonicalUuidV4(applicationId, "applicationId");
  return requestApi<ApplicationTransitionResult>(applicationResourceRoute(applicationId, "withdraw"), {
    method: "PATCH",
    body,
    privateData: true,
    signal,
    maxRetries: 0,
  });
}

export async function refreshApplicationMatchScore(
  applicationId: string,
  applicationVersion: number,
  signal?: AbortSignal,
): Promise<ApiEnvelope<ApplicationMatchScoreResult>> {
  const body = buildMatchRefreshCommand(applicationVersion);
  if (isDemoPerson2Api) {
    return { data: { applicationId, matchScore: 91, version: body.expectedVersion + 1 }, meta: null };
  }
  assertCanonicalUuidV4(applicationId, "applicationId");
  return requestApi<ApplicationMatchScoreResult>(applicationResourceRoute(applicationId, "match-score/refresh"), {
    method: "POST",
    body,
    privateData: true,
    signal,
    maxRetries: 0,
  });
}

export async function sendApplicationOffer(
  applicationId: string,
  values: SendOfferValues,
  signal?: AbortSignal,
): Promise<ApiEnvelope<ApplicationOfferMutationResult>> {
  const body = buildSendOfferCommand(values);
  if (isDemoPerson2Api) {
    return { data: { id: `offer-${Date.now()}`, applicationId, salary: values.salary, startDate: values.startDate, position: values.position, note: values.note ?? null, fileId: values.fileId ?? null, fileUrl: values.fileUrl ?? null, status: "SENT", sentAt: new Date().toISOString(), expiresAt: values.expiresAt, respondedAt: null, responseNote: null, version: 0, applicationStatus: "OFFER", applicationVersion: body.expectedApplicationVersion + 1 }, meta: null };
  }
  assertCanonicalUuidV4(applicationId, "applicationId");
  return requestApi<ApplicationOfferMutationResult>(applicationResourceRoute(applicationId, "offer"), {
    method: "POST",
    body,
    privateData: true,
    signal,
    maxRetries: 0,
  });
}

export async function respondToApplicationOffer(
  offerId: string,
  input: { decision: OfferDecision; declineReason?: string; offerVersion: number; applicationVersion: number },
  signal?: AbortSignal,
): Promise<ApiEnvelope<ApplicationOfferMutationResult>> {
  const body = buildOfferResponseCommand(input);
  if (isDemoPerson2Api) {
    const offer = demo.offers.find((item) => item.id === offerId);
    if (!offer) throw new ApiClientError({ code: "OFFER_NOT_FOUND", status: 404 });
    const now = new Date().toISOString();
    return { data: { id: offer.id, applicationId: offer.applicationId, salary: offer.salary, startDate: now.slice(0, 10), position: offer.jobTitle, note: null, fileId: offer.fileId ?? null, fileUrl: offer.fileUrl ?? null, status: input.decision, sentAt: now, expiresAt: offer.expiresAt, respondedAt: now, responseNote: input.declineReason ?? null, version: body.expectedOfferVersion + 1, applicationStatus: input.decision === "ACCEPTED" ? "HIRED" : "REJECTED", applicationVersion: body.expectedApplicationVersion + 1 }, meta: null };
  }
  assertCanonicalUuidV4(offerId, "offerId");
  return requestApi<ApplicationOfferMutationResult>(offerResponseRoute(offerId), {
    method: "PATCH",
    body,
    privateData: true,
    signal,
    maxRetries: 0,
  });
}

export async function getRecommendationsForCandidate(
  options: { cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<ApiEnvelope<JobRecommendation[]>> {
  if (isDemoPerson2Api) {
    const response = await normalizeDemo(demo.getRecommendationsForCandidate());
    return {
      ...response,
      meta: {
        source: response.data[0]?.source ?? "LATEST",
        nextCursor: null,
        hasMore: false,
      },
    };
  }
  const response = await requestApi<JobRecommendationResult>(PERSON2_AI_PUBLIC_ROUTES.candidateJobRecommendations, {
    privateData: true,
    signal,
    query: { limit: options.limit ?? 10, cursor: options.cursor },
    allowedQueryKeys: ["limit", "cursor"],
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
      fallbackReason: response.data.fallbackReason,
      nextCursor: response.data.nextCursor,
      hasMore: response.data.source === "AI" && response.data.nextCursor !== null,
    },
  };
}

export async function getRecruiterCandidateRecommendations(
  jobId: string,
  options: { cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<ApiEnvelope<RecruiterCandidateRecommendationResult>> {
  if (isDemoPerson2Api) {
    const job = demo.jobs.find((item) => item.id === jobId);
    if (!job) throw new ApiClientError({ code: "JOB_NOT_FOUND", status: 404 });
    if (job.id === "job-product-003") {
      return {
        data: {
          jobId,
          items: [],
          nextCursor: null,
          reason: "JOB_EMBEDDING_NOT_FOUND",
        },
        meta: null,
      };
    }
    return {
      data: {
        jobId,
        items: [
          {
            candidateId: "candidate-discovery-001",
            fullName: "Trần Minh Anh",
            headline: "Frontend Engineer · 4 năm kinh nghiệm",
            skills: ["React", "TypeScript", "Next.js"],
            score: 0.92,
          },
          {
            candidateId: "candidate-discovery-002",
            fullName: "Nguyễn Hoàng Nam",
            headline: "Full-stack Developer",
            skills: ["TypeScript", "Node.js", "PostgreSQL"],
            score: 0.84,
          },
        ],
        nextCursor: null,
        reason: null,
      },
      meta: null,
    };
  }
  const response = await requestApi<RecruiterCandidateRecommendationResult>(
    recruiterCandidateRecommendationsRoute(jobId),
    {
      privateData: true,
      signal,
      query: { limit: options.limit ?? 10, cursor: options.cursor },
      allowedQueryKeys: ["limit", "cursor"],
      maxRetries: 0,
    },
  );
  if (response.data.items.length === 0 && response.data.reason === null) {
    throw new ApiClientError({ code: "INVALID_API_RESPONSE" });
  }
  return response;
}

export async function getOffer(id: string, signal?: AbortSignal): Promise<ApiEnvelope<Offer | null>> {
  if (isDemoPerson2Api) return normalizeDemo(demo.getOffer(id));
  assertCanonicalUuidV4(id, "offerId");
  const response = await requestApi<ApplicationOfferMutationResult>(`${API_PATHS.offers}${id}`, { privateData: true, signal });
  const value = response.data;
  return { ...response, data: {
    id: value.id, applicationId: value.applicationId, candidateName: "Ứng viên",
    jobTitle: value.position, salary: String(value.salary),
    offerVersion: value.version, applicationVersion: value.applicationVersion,
    status: value.status === "SENT" ? "PENDING_CANDIDATE_RESPONSE" : value.status,
    expiresAt: value.expiresAt, fileId: value.fileId ?? undefined, fileUrl: value.fileUrl ?? undefined,
    startDate: value.startDate, note: value.note, responseNote: value.responseNote,
    applicationStatus: value.applicationStatus,
  } };
}

export async function getApplicationEvaluations(applicationId: string, signal?: AbortSignal): Promise<ApiEnvelope<ApplicationEvaluationResult[]>> {
  if (isDemoPerson2Api) return { data: [], meta: null };
  assertCanonicalUuidV4(applicationId, "applicationId");
  return requestApi<ApplicationEvaluationResult[]>(applicationResourceRoute(applicationId, "evaluations"), { privateData: true, signal });
}

export interface ActiveCandidateCv {
  id: string;
  title: string;
  type: "UPLOAD" | "ONLINE";
  isDefault: boolean;
  createdAt: string;
}

export async function getActiveCandidateCvs(signal?: AbortSignal): Promise<ApiEnvelope<ActiveCandidateCv[]>> {
  if (isDemoPerson2Api) return { data: [
    { id: "cv-frontend-01", title: "CV Frontend Senior", type: "UPLOAD", isDefault: true, createdAt: new Date(0).toISOString() },
    { id: "cv-frontend-02", title: "CV Frontend Junior", type: "ONLINE", isDefault: false, createdAt: new Date(0).toISOString() },
  ], meta: null };
  return requestApi<ActiveCandidateCv[]>("/profile/cvs", { privateData: true, signal });
}

export async function saveCandidateBookmark(jobId: string, signal?: AbortSignal): Promise<ApiEnvelope<CandidateBookmark>> {
  if (isDemoPerson2Api) return { data: { id: `bookmark-${jobId}`, jobId, createdAt: new Date().toISOString(), job: null }, meta: null };
  assertCanonicalUuidV4(jobId, "jobId");
  return requestApi<CandidateBookmark>(APPLICATION_API_ROUTES.bookmarks, {
    method: "POST", privateData: true, signal, body: { jobId }, maxRetries: 0,
  });
}

export async function removeCandidateBookmark(jobId: string, signal?: AbortSignal): Promise<ApiEnvelope<void>> {
  if (isDemoPerson2Api) return { data: undefined, meta: null };
  assertCanonicalUuidV4(jobId, "jobId");
  return requestApi<void>(`${APPLICATION_API_ROUTES.bookmarks}/${jobId}`, {
    method: "DELETE", privateData: true, signal, maxRetries: 0,
  });
}
