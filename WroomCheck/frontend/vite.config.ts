import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" lets the build run from any path (GitHub Pages project sites).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
