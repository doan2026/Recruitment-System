export interface CompanyMediaLibraryItem {
  fileId: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  sortOrder: number;
}

export function normalizeCompanyMediaLibrary(
  items: readonly CompanyMediaLibraryItem[],
): CompanyMediaLibraryItem[] {
  return items.map((item, index) => ({ ...item, sortOrder: index }));
}

export function validateCompanyMediaLibrary(
  logoFileId: string | undefined,
  items: readonly CompanyMediaLibraryItem[],
): string | null {
  const imageCount = items.filter((item) => item.type === "IMAGE").length;
  const videoCount = items.filter((item) => item.type === "VIDEO").length;
  if (imageCount > 10) return "Thư viện chỉ được có tối đa 10 ảnh.";
  if (videoCount > 1) return "Thư viện chỉ được có tối đa 1 video.";
  const ids = [...(logoFileId ? [logoFileId] : []), ...items.map((item) => item.fileId)];
  if (new Set(ids).size !== ids.length) return "Mỗi file chỉ được dùng một lần, kể cả logo.";
  return null;
}

export function moveCompanyMediaItem(
  items: readonly CompanyMediaLibraryItem[],
  fileId: string,
  targetIndex: number,
): CompanyMediaLibraryItem[] {
  const currentIndex = items.findIndex((item) => item.fileId === fileId);
  if (currentIndex < 0) return normalizeCompanyMediaLibrary(items);
  const next = [...items];
  const [item] = next.splice(currentIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, item);
  return normalizeCompanyMediaLibrary(next);
}
