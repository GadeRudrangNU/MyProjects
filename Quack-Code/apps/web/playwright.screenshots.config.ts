import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Not part of the normal suite: run with `npm run screenshots` to regenerate docs/screenshots.
export default defineConfig({
  ...base,
  testDir: './e2e-screenshots',
  timeout: 180_000,
  use: { ...base.use, colorScheme: 'dark', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
});
