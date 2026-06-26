import { defineConfig } from "tsdown";

// Library build: a single ESM entry plus type declarations. Matches the
// org's tsdown/esbuild toolchain (see openclaw).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
});
