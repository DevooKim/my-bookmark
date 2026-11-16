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
        // Preserve the existing stable URL and its network-first SW policy.
        assetFileNames: (assetInfo) =>
          assetInfo.names?.includes("styles.css")
            ? "assets/app-styles[extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    devtools(),
    nitro(),
    tailwindcss(),
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: "/index.html" } },
    }),
    viteReact(),
  ],
});

export default config;
