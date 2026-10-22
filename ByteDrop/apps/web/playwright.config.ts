import { defineConfig, devices } from "@playwright/test";

const channel = process.env.PW_CHANNEL || (process.env.CI ? undefined : "msedge");
const live = "http://127.0.0.1:3100";
const demo = "http://127.0.0.1:3200";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: { ...devices["Desktop Chrome"], channel, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "live", testDir: "./e2e/live", use: { baseURL: live } },
    { name: "demo", testDir: "./e2e/demo", use: { baseURL: demo } },
  ],
  webServer: {
    command: "pnpm start:demo",
    url: `${demo}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    env: { NEXT_DIST_DIR: ".next-demo", NEXT_PUBLIC_DEMO: "1" },
  },
});
