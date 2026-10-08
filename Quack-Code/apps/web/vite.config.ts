import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API (and its WebSocket) is proxied, so the session cookie stays same-origin.
const api = process.env.API_URL ?? 'http://localhost:4000';
const port = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    proxy: {
      '/api': { target: api, ws: true },
      '/healthz': api,
    },
  },
  build: { chunkSizeWarningLimit: 700 },
});
