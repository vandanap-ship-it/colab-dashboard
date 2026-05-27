import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config for Siddhi.
 *
 * Tests run against the local Next.js dev server on http://localhost:3000.
 * The dev server is started automatically by Playwright if it isn't already.
 * The test DB is the local ./dev.db (seeded via npx tsx prisma/seed.ts).
 *
 * Run:
 *   npx playwright test               # run all tests, headless
 *   npx playwright test --ui          # open the UI runner for debugging
 *   npx playwright test --headed      # run with the browser visible
 *   npx playwright test auth.spec     # run a single file
 *   npx playwright show-report        # open the HTML report after a run
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // tests share the seeded dev DB, so serial is safer for now
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
      testIgnore: /mobile\.spec/,
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 14"] },
      testMatch: /mobile\.spec/,
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
