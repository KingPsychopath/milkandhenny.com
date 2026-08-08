import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "node",
    globalSetup: ["./vitest.globalSetup.ts"],
    // Database suites queue behind a shared advisory lock (see
    // __tests__/helpers/postgres.ts); the waiting file must not time out.
    hookTimeout: 120_000,
    include: ["__tests__/unit/**/*.test.ts", "__tests__/integration/**/*.test.ts"],
    coverage: {
      include: ["lib/**/*.ts", "features/**/*.ts"],
      exclude: ["lib/platform/redis.ts", "lib/platform/r2.ts", "lib/platform/logger.ts"],
    },
  },
});
