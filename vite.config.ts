import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Screenshot capture uses its own D1 directory so it does not share the e2e database.
const persistPath =
  process.env.FLAREBOT_PERSIST ||
  (process.env.FLAREBOT_E2E ? ".wrangler/e2e" : undefined);

function localeHtml(): Plugin {
  return {
    name: "flarebot-locale-html",
    transformIndexHtml(html) {
      const locale = JSON.parse(
        readFileSync(
          path.resolve(import.meta.dirname, "brand/locale.json"),
          "utf8",
        ),
      ) as { lang: string; messages: { app_name: string } };
      const title = locale.messages.app_name
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      return html
        .replaceAll("%locale.lang%", locale.lang)
        .replaceAll("%locale.app_name%", title);
    },
  };
}

function brandUi(): Plugin {
  return {
    name: "flarebot-brand-ui",
    enforce: "pre",
    resolveId(source) {
      if (!source.startsWith("@/ui/")) return null;
      const name = source.slice("@/ui/".length);
      const branded = path.resolve(
        import.meta.dirname,
        "brand/ui",
        `${name}.tsx`,
      );
      if (existsSync(branded)) return branded;
      return path.resolve(import.meta.dirname, "src/ui", `${name}.tsx`);
    },
  };
}

export default defineConfig({
  plugins: [
    localeHtml(),
    brandUi(),
    react(),
    tailwindcss(),
    cloudflare({
      persistState: persistPath ? { path: persistPath } : undefined,
      inspectorPort: process.env.FLAREBOT_E2E ? false : undefined,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@brand": path.resolve(import.meta.dirname, "brand"),
    },
  },
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  preview: { port: 4173, strictPort: true, host: "127.0.0.1" },
});
