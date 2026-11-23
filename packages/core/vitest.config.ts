import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    nodeironment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/e2e/**", "**/*.e2e.ts"],
  },
});
