import { API_PATHS, ApiClientError, assertCanonicalUuidV4 } from "./apiClientCore";

const INTERNAL_AI_ROUTE = /^\/(?:api\/)?ai\/(?:match|recommend\/(?:jobs|candidates))(?:[/?#]|$)/;
const RECRUITER_RECOMMENDATION_ROUTE = new RegExp(
  `^/api/jobs/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/recommended-candidates$`,
);

export function assertPerson2AiPublicRoute(path: string): string {
  const isPublic = path === API_PATHS.aiChat
    || path === API_PATHS.jobRecommended
    || RECRUITER_RECOMMENDATION_ROUTE.test(path);
  if (!isPublic || INTERNAL_AI_ROUTE.test(path)) {
    throw new ApiClientError({ code: "AI_PUBLIC_ROUTE_REQUIRED" });
  }
  return path;
}

export const PERSON2_AI_PUBLIC_ROUTES = Object.freeze({
  chat: assertPerson2AiPublicRoute(API_PATHS.aiChat),
  candidateJobRecommendations: assertPerson2AiPublicRoute(API_PATHS.jobRecommended),
});

export function recruiterCandidateRecommendationsRoute(jobId: string): string {
  const canonicalJobId = assertCanonicalUuidV4(jobId, "jobId");
  return assertPerson2AiPublicRoute(`${API_PATHS.jobs}${canonicalJobId}/recommended-candidates`);
}
