import { defineConfig } from '@playwright/test';

const API_PORT = 4100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: './e2e-results',
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  webServer: [
    {
      // Fresh embedded Postgres on its own port and directory, so dev data is never touched.
      command: 'node e2e/start-api.mjs',
      url: `http://localhost:${API_PORT}/readyz`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { PORT: String(API_PORT), WEB_ORIGIN: `http://localhost:${WEB_PORT}`, EMBEDDED_PG_PORT: '54340', EMBEDDED_PG_DIR: '.pgdata-e2e', LOG_LEVEL: 'warn' },
    },
    {
      command: 'npm run dev',
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}`, WEB_PORT: String(WEB_PORT) },
    },
  ],
});
