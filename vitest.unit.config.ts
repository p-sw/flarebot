import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: [
      "**/*.worker.test.ts",
      "e2e/**",
      "node_modules/**",
      "dist/**",
      "src/paraglide/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage/unit",
      include: ["shared/**/*.ts", "worker/**/*.ts", "scripts/**/*.mjs"],
      exclude: ["**/*.test.ts", "**/*.worker.test.ts"],
    },
  },
});
