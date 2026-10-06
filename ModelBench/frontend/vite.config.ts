import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// VITE_API_URL: backend origin for production builds (empty in dev: the proxy below handles it).
// VITE_BASE: sub-path when hosted on GitHub Pages (e.g. /modelbench/).
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  define: { __API_URL__: JSON.stringify(process.env.VITE_API_URL ?? "") },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
