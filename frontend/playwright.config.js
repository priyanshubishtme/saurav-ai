import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "node backend/test/e2eServer.js",
      cwd: "..",
      url: "http://127.0.0.1:3101/api/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5174",
      env: { VITE_API_PROXY_TARGET: "http://127.0.0.1:3101", VITE_PORT: "5174" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
