import { expect, type Page } from "@playwright/test";

export async function openWorkspaceMenu(page: Page) {
  await expect(page.locator(".workspace-header")).toBeVisible();
  const toggle = page.getByRole("button", { name: "Mở menu", exact: true });
  if (await toggle.isVisible()) {
    await toggle.click();
    await expect(page.locator(".workspace-sidebar")).toBeVisible();
  }
}
