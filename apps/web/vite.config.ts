import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  worker: { format: "es" },
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