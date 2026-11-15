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
  define: { __BUILD_ID__: JSON.stringify(new Date().toISOString()) },
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
        // 해시 없는 고정 URL이라 배포마다 내용이 바뀐다. 매번 ETag로 재검증해
        // (변경 없으면 304) 배포 직후에도 새 CSS가 바로 적용되게 한다.
        "/assets/app-styles.css": {
          headers: { "cache-control": "no-cache" },
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
