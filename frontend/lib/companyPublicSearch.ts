import type { PublicCompanySummary } from "./person2Api";

export function mergePublicCompanyPage(
  current: readonly PublicCompanySummary[],
  incoming: readonly PublicCompanySummary[],
  append: boolean,
): PublicCompanySummary[] {
  if (!append) return [...incoming];
  const seen = new Set(current.map((company) => company.id));
  return [...current, ...incoming.filter((company) => !seen.has(company.id))];
}

export function shouldLockCompanySearch(hasMore: boolean, cursor: string | null): boolean {
  return hasMore || cursor !== null;
}
