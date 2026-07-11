import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  sourcemap: true,
  clean: true,
  // Single-file output: esm chunk splitting evaluates shared chunks (env.ts)
  // before the inlined dotenv side effect in the entry body.
  splitting: false,
  noExternal: [/^@my-bookmark\//],
  banner: {
    // Bundled CJS deps (AI SDKs via @my-bookmark/ai) use dynamic require of
    // node builtins; esbuild's ESM require shim needs a real require to exist.
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
