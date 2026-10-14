import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8080',
    channel: process.env.PW_CHANNEL ?? 'msedge',
    viewport: { width: 1440, height: 900 },
  },
})
