import { defineConfig, devices } from "@playwright/test";

const origin = "http://127.0.0.1:4174";

export default defineConfig({
  testDir: "scripts",
  testMatch: /screenshots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: origin,
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "node scripts/screenshot-preview.mjs",
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    // Default teardown is SIGKILL, which skips the preview script's cleanup.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
