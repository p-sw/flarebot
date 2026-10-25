import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@brand": path.resolve(import.meta.dirname, "brand"),
    },
  },
  test: {
    name: "unit",
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/*.worker.test.ts", "e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage/unit",
      include: ["shared/**/*.ts", "worker/**/*.ts", "scripts/**/*.mjs"],
      exclude: ["**/*.test.ts", "**/*.worker.test.ts"],
    },
  },
});
