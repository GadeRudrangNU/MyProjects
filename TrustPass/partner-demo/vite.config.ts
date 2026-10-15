/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: Number(process.env.PARTNER_PORT ?? 5174),
    strictPort: true,
  },
  test: {
    environment: 'node',
  },
})
