import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  base: "/Run-To-Exit/",
  server: { allowedHosts: ["terminal.local"] },
  preview: { allowedHosts: ["terminal.local"] },
  build: {
    target: "es2022",
    manifest: true,
    // Preserve the entry's Game export for public coordinate inspection in E2E tests.
    rolldownOptions: {
      preserveEntrySignatures: "strict",
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        game: fileURLToPath(new URL("./src/main.ts", import.meta.url)),
      },
    },
  },
});
