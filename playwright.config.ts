import { defineConfig, devices } from "@playwright/test";

process.loadEnvFile(".env");

// Tests run against their own database, so `npm test` never touches development data.
const testUrl = new URL(process.env.DATABASE_URL ?? "");
testUrl.pathname = "/scholarlogic_test";
process.env.DATABASE_URL = testUrl.toString();

const PORT = 3200;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  // Tests share one database and count rows in it, so they run one at a time, in file order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1360, height: 860 },
    colorScheme: "light",
    // Uses the Edge already on Windows. Set PW_CHANNEL=chromium after `npx playwright install chromium` elsewhere.
    channel: process.env.PW_CHANNEL ?? "msedge",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: testUrl.toString(), NEXT_DIST_DIR: ".next-test", UPLOAD_DIR: ".next-test/uploads" },
  },
});
