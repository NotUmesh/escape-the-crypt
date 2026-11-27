import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
// A fake worker origin for the e2e build. Nothing listens here; the specs answer it with page.route.
export const FAKE_WORKER_ORIGIN = "http://127.0.0.1:8799";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      // axe on a page that has run the pdf.js worker crashes Playwright's Firefox; a
      // canned-pages scan of the same screen runs there instead (e2e/ingest.e2e.ts).
      grepInvert: /@real-pdf-axe/,
    },
    { name: "pixel", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm build --mode e2e && pnpm preview --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_WORKER_URL: FAKE_WORKER_ORIGIN },
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
