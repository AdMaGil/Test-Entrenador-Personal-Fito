import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// base relativa: funciona en GitHub Pages bajo /<repo>/ y en local
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
