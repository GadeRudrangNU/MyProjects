import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  noExternal: ["@bytedrop/shared"],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
