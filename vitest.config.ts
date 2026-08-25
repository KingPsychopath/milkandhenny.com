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
    // __tests__/helpers/postgres.ts); unit suites remain parallel while database files take
    // turns resetting the shared schema.
    fileParallelism: true,
    // The waiting database file must not time out while another suite holds the
    // lock. Files with several database suites re-acquire it between suites, so
    // the worst case is waiting out another file's slowest full suite — 120s
    // was intermittently too tight for checkpoints-scanner-links under a full
    // parallel run.
    hookTimeout: 300_000,
    include: ["__tests__/unit/**/*.test.ts", "__tests__/integration/**/*.test.ts"],
    coverage: {
      include: ["lib/**/*.ts", "features/**/*.ts"],
      exclude: [
        "lib/platform/redis.server.ts",
        "lib/platform/r2.server.ts",
        "lib/platform/logger.server.ts",
      ],
      thresholds: {
        statements: 44,
        branches: 41,
        functions: 44,
        lines: 45,
      },
    },
  },
});
