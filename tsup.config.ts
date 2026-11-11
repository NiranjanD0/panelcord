import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "deploy-commands": "src/scripts/deploy-commands.ts",
  },
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  minify: false,
  shims: true,
});
