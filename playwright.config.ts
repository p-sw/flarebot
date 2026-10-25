import { defineConfig, devices } from "@playwright/test";

const brandPreview = process.env.BRAND_PREVIEW === "1";
const origin = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  workers: brandPreview ? 1 : 2,
  timeout: 20_000,
  expect: { timeout: 8_000 },
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node scripts/ensure-dev-vars.mjs && pnpm build && pnpm exec wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e && FLAREBOT_E2E=1 pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: `${origin}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: brandPreview
        ? /auth\.setup\.ts/
        : [/auth\.setup\.ts/, /preview\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
