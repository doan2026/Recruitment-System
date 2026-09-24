import { defineConfig } from "@playwright/test";

const appOrigin = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: appOrigin,
    channel: "chrome",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chrome", use: { viewport: { width: 1440, height: 960 } } },
    { name: "mobile-chrome", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 4173",
    url: appOrigin,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_E2E: "true",
      NEXT_PUBLIC_API_MODE: "gateway",
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:4174",
    },
  },
});
