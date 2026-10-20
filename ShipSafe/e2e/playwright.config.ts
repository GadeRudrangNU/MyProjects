import { defineConfig } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const api = "http://localhost:5081";
const dashboard = "http://localhost:5174";
const demo = "http://localhost:5201";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    channel: process.env.CI ? undefined : "msedge",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "dotnet run --project src/ShipSafe.Server --no-launch-profile -- --urls http://localhost:5081",
      cwd: root,
      url: `${api}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ShipSafe__Database: `Data Source=${join(root, "e2e", "e2e.db")}`,
        ShipSafe__SeedDemo: "true",
      },
    },
    {
      command: "npm run dev -w dashboard",
      cwd: root,
      url: dashboard,
      reuseExistingServer: false,
      env: { SHIPSAFE_API: api, DASHBOARD_PORT: "5174" },
    },
    {
      command: "npm run start -w demo",
      cwd: root,
      url: demo,
      reuseExistingServer: false,
      env: { DEMO_PORT: "5201", SHIPSAFE_URL: api },
    },
  ],
  metadata: { api, dashboard, demo },
});
