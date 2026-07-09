import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  resolve: { tsconfigPaths: true },
  build: {
    rollupOptions: {
      output: {
        // styles.css must keep one stable URL: the SSR pass links its own
        // hash, which can differ from the client pass emit (observed in the
        // linux Docker build) and 404 → unstyled first paint (CLS).
        assetFileNames: (assetInfo) =>
          assetInfo.names?.includes("styles.css")
            ? "assets/app-styles[extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    devtools(),
    nitro({
      rollupConfig: { external: [/^@sentry\//] },
      compressPublicAssets: { gzip: true, brotli: true },
      routeRules: {
        "/assets/app-styles.css": {
          headers: { "cache-control": "public, max-age=3600" },
        },
        "/assets/**": {
          headers: { "cache-control": "public, max-age=31536000, immutable" },
        },
        "/icons/**": {
          headers: { "cache-control": "public, max-age=3600" },
        },
        "/manifest.webmanifest": {
          headers: { "cache-control": "public, max-age=3600" },
        },
        "/sw.js": {
          headers: { "cache-control": "no-cache" },
        },
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
