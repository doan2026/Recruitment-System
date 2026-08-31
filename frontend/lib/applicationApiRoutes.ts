import { API_PATHS } from "./apiClientCore";

export const APPLICATION_API_ROUTES = Object.freeze({
  collection: API_PATHS.applications,
  bookmarks: API_PATHS.bookmarks,
  offers: API_PATHS.offers,
});

export function applicationResourceRoute(applicationId: string, suffix = ""): string {
  return `${APPLICATION_API_ROUTES.collection}${applicationId}${suffix ? `/${suffix}` : ""}`;
}

export function recruiterDashboardRoute(): string {
  return `${APPLICATION_API_ROUTES.collection}stats`;
}

export function offerResponseRoute(offerId: string): string {
  return `${APPLICATION_API_ROUTES.offers}${offerId}/respond`;
}
