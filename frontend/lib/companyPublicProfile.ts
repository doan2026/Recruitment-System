import type { PublicCompanyMedia } from "./person2Api";

export function companyLogoFallback(name: string): string {
  const firstCharacter = Array.from(name.trim())[0];
  return firstCharacter ? firstCharacter.toLocaleUpperCase("vi-VN") : "DN";
}

export function orderPublicCompanyMedia(
  media: readonly PublicCompanyMedia[],
): PublicCompanyMedia[] {
  return [...media]
    .filter((item) => item.url.trim().length > 0)
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.url.localeCompare(right.url);
    });
}
