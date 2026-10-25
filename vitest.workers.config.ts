import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SETUP_SECRET: "test-setup-secret",
            ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
            ALLOW_TEST_MAIL: "1",
          },
        },
      }),
    ],
    test: {
      include: ["**/*.worker.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
