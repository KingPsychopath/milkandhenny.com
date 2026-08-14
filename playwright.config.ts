import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";
const testDatabase =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node scripts/test-s3-server.mjs",
      url: "http://127.0.0.1:4568/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm dev --host 127.0.0.1 --port 4173",
      url: `${baseURL}/things/pitches/new`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        DATABASE_URL: testDatabase,
        VITE_BASE_URL: baseURL,
        VITE_MEDIA_PUBLIC_URL: "http://127.0.0.1:4568/public",
        AUTH_SECRET: "playwright-auth-secret-at-least-thirty-two-characters",
        ADMIN_PASSWORD: "playwright-admin-password",
        UPLOAD_PIN: "playwright-upload-pin",
        R2_ACCOUNT_ID: "test",
        R2_ACCESS_KEY: "test-access-key",
        R2_SECRET_KEY: "test-secret-key",
        R2_PUBLIC_BUCKET: "public",
        R2_PRIVATE_BUCKET: "private",
        S3_ENDPOINT: "http://127.0.0.1:4568",
      },
    },
  ],
});
