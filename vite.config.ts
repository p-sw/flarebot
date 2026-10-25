import { existsSync } from "node:fs";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

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
  plugins: [brandUi(), react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@brand": path.resolve(import.meta.dirname, "brand"),
    },
  },
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
});
