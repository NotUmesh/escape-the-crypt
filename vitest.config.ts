import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "apps/web",
      "apps/worker",
      { test: { name: "scripts", include: ["scripts/**/*.test.ts"], environment: "node" } },
    ],
  },
});