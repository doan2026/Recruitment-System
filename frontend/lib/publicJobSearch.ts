export type PublicJobSearchSort = "RELEVANCE" | "NEWEST" | "SALARY_DESC";
export type PublicJobTypeFilter = "" | "FULL_TIME" | "PART_TIME" | "CONTRACT";

export interface PublicJobSearchForm {
  q: string;
  location: string;
  salaryMin: string;
  salaryMax: string;
  skills: string;
  experienceYears: string;
  jobType: PublicJobTypeFilter;
  sort: PublicJobSearchSort;
}

export interface PublicJobSearchFilters {
  q?: string;
  location?: string;
  salaryMin?: number;
  salaryMax?: number;
  skills?: string[];
  experienceYears?: number;
  jobType?: Exclude<PublicJobTypeFilter, "">;
  sort: PublicJobSearchSort;
}

export const emptyPublicJobSearchForm: PublicJobSearchForm = {
  q: "",
  location: "",
  salaryMin: "",
  salaryMax: "",
  skills: "",
  experienceYears: "",
  jobType: "",
  sort: "RELEVANCE",
};

export function validatePublicJobSearch(values: PublicJobSearchForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const salaryMin = values.salaryMin.trim() ? Number(values.salaryMin) : undefined;
  const salaryMax = values.salaryMax.trim() ? Number(values.salaryMax) : undefined;
  if (
    (salaryMin !== undefined && (!Number.isFinite(salaryMin) || salaryMin < 0)) ||
    (salaryMax !== undefined && (!Number.isFinite(salaryMax) || salaryMax < 0)) ||
    (salaryMin !== undefined && salaryMax !== undefined && salaryMin > salaryMax)
  ) {
    errors.salary = "Khoảng lương phải là số không âm và mức tối thiểu không lớn hơn tối đa.";
  }
  const skills = values.skills.split(",").map((value) => value.normalize("NFKC").trim()).filter(Boolean);
  if (skills.length > 50) errors.skills = "Chỉ được lọc tối đa 50 kỹ năng.";
  if (values.experienceYears.trim()) {
    const years = Number(values.experienceYears);
    if (!Number.isInteger(years) || years < 0 || years > 60) errors.experienceYears = "Kinh nghiệm phải là số nguyên từ 0 đến 60.";
  }
  if (values.q.trim().length > 200) errors.q = "Từ khóa tối đa 200 ký tự.";
  if (values.location.trim().length > 255) errors.location = "Địa điểm tối đa 255 ký tự.";
  return errors;
}

export function normalizePublicJobSearch(values: PublicJobSearchForm): PublicJobSearchFilters {
  const filters: PublicJobSearchFilters = { sort: values.sort };
  const q = values.q.normalize("NFKC").trim();
  const location = values.location.normalize("NFKC").trim();
  const skills = [...new Set(values.skills.split(",").map((value) => value.normalize("NFKC").trim()).filter(Boolean))];
  if (q) filters.q = q;
  if (location) filters.location = location;
  if (values.salaryMin.trim()) filters.salaryMin = Number(values.salaryMin);
  if (values.salaryMax.trim()) filters.salaryMax = Number(values.salaryMax);
  if (skills.length) filters.skills = skills;
  if (values.experienceYears.trim()) filters.experienceYears = Number(values.experienceYears);
  if (values.jobType) filters.jobType = values.jobType;
  return filters;
}

export function publicJobSearchScope(filters: PublicJobSearchFilters, limit: number): string {
  return JSON.stringify({ ...filters, limit });
}

export function isOffsetWindowTooDeep(page: number, limit: number): boolean {
  return page * limit > 10_000;
}

export function mergePublicJobPage<T extends { id: string }>(
  current: T[],
  incoming: T[],
  continuation: boolean,
): T[] {
  if (!continuation) return incoming;
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
