import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { headersWithWorkerOrigin } from "./src/features/generate/csp-headers";
import { parseWorkerOrigin } from "./src/features/generate/worker-config";

// `vite preview` ignores Cloudflare Pages `_headers`, so apply the same global rules here.
// That way the e2e suite runs under the production CSP.
function pagesHeaders(rawOrigin: string | undefined): Record<string, string> {
  const source = readFileSync(fileURLToPath(new URL("./public/_headers", import.meta.url)), "utf8");
  // Same rewrite the build applies to `dist/_headers`, so preview runs under the same connect-src.
  const origin = parseWorkerOrigin(rawOrigin);
  const file = origin === null ? source : headersWithWorkerOrigin(source, origin);
  const headers: Record<string, string> = {};
  for (const line of file.split(/\r?\n/)) {
    const match = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (match?.[1] && match[2]) headers[match[1]] = match[2].trim();
  }
  return headers;
}

// Adds the build-time worker origin to connect-src in the built `_headers` (the source file is untouched).
function workerOriginHeaders(rawOrigin: string | undefined, outDir: string): Plugin {
  return {
    name: "worker-origin-headers",
    apply: "build",
    closeBundle() {
      const origin = parseWorkerOrigin(rawOrigin);
      if (origin === null) return;
      const file = fileURLToPath(new URL(`./${outDir}/_headers`, import.meta.url));
      writeFileSync(file, headersWithWorkerOrigin(readFileSync(file, "utf8"), origin));
    },
  };
}
export default defineConfig(({ mode }) => {
  const workerUrl = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_").VITE_WORKER_URL;
  return {
  plugins: [react(), workerOriginHeaders(workerUrl, mode === "e2e" ? "dist-e2e" : "dist")],
  worker: { format: "es" },
  preview: { headers: pagesHeaders(workerUrl) },
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
  };
});
