import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `vite preview` ignores Cloudflare Pages `_headers`, so apply the same global rules here.
// That way the e2e suite runs under the production CSP.
function pagesHeaders(): Record<string, string> {
  const file = readFileSync(fileURLToPath(new URL("./public/_headers", import.meta.url)), "utf8");
  const headers: Record<string, string> = {};
  for (const line of file.split(/\r?\n/)) {
    const match = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (match?.[1] && match[2]) headers[match[1]] = match[2].trim();
  }
  return headers;
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  worker: { format: "es" },
  preview: { headers: pagesHeaders() },
  build: {
    // The e2e build goes to its own folder, so dist only ever holds a normal build.
    outDir: mode === "e2e" ? "dist-e2e" : "dist",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        // The layout-test parent is built only for end-to-end runs (`--mode e2e`).
        ...(mode === "e2e"
          ? { "test-parent": fileURLToPath(new URL("./test-parent.html", import.meta.url)) }
          : {}),
      },
    },
  },
}));