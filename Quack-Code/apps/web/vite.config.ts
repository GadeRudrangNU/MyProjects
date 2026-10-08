import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API (and its WebSocket) is proxied, so the session cookie stays same-origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', ws: true },
      '/healthz': 'http://localhost:4000',
    },
  },
  build: { chunkSizeWarningLimit: 700 },
});
