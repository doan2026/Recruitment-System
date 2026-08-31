import type { JobStatus } from "./demoData";

export type RecruiterJobSort = "UPDATED_DESC" | "DEADLINE_ASC" | "TITLE_ASC";

export interface RecruiterJobTableRow {
  id: string;
  title: string;
  status: JobStatus;
  location: string;
  department: string;
  ownerName: string;
  deadline: string;
  updatedAt: string;
}

export interface RecruiterJobTableOptions {
  query: string;
  status: "ALL" | JobStatus;
  sort: RecruiterJobSort;
  page: number;
  pageSize: number;
}

export interface RecruiterJobTableResult<T> {
  items: T[];
  filteredCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  from: number;
  to: number;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildRecruiterJobTable<T extends RecruiterJobTableRow>(
  jobs: readonly T[],
  options: RecruiterJobTableOptions,
): RecruiterJobTableResult<T> {
  const query = options.query.normalize("NFKC").trim().toLocaleLowerCase("vi-VN");
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const filtered = jobs.filter((job) => {
    const searchable = [job.title, job.location, job.department, job.ownerName]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase("vi-VN");
    return (!query || searchable.includes(query))
      && (options.status === "ALL" || job.status === options.status);
  });

  const sorted = [...filtered].sort((left, right) => {
    let comparison = 0;
    if (options.sort === "TITLE_ASC") {
      comparison = left.title.localeCompare(right.title, "vi-VN", { sensitivity: "base" });
    } else if (options.sort === "DEADLINE_ASC") {
      comparison = timestamp(left.deadline) - timestamp(right.deadline);
    } else {
      comparison = timestamp(right.updatedAt) - timestamp(left.updatedAt);
    }
    return comparison || left.id.localeCompare(right.id);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const requestedPage = Math.max(1, Math.floor(options.page));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize);

  return {
    items,
    filteredCount: sorted.length,
    page,
    pageSize,
    totalPages,
    from: sorted.length === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, sorted.length),
  };
}
