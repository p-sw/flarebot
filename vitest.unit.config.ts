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
  },
});
