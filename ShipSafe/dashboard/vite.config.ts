import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.SHIPSAFE_API ?? "http://localhost:5080";
const port = Number(process.env.DASHBOARD_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    strictPort: true,
    proxy: {
      "/api": api,
    },
  },
});
