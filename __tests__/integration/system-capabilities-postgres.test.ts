import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import {
  getMediaWorkerCapabilities,
  getSystemCapabilities,
  probeMediaWorkerCapabilities,
} from "@/features/system/capabilities.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres operational capabilities", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  afterEach(() => vi.unstubAllEnvs());

  it("reports the Postgres worker queue and realtime backplane without Redis", async () => {
    vi.stubEnv("MEDIA_PROCESSOR_MODE", "hybrid");
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    vi.stubEnv("TRANSFER_CATALOGUE_STORE", "postgres");
    vi.stubEnv("MEDIA_WORKER_STATUS_STORE", "postgres");
    vi.stubEnv("MULTIPLAYER_REALTIME_BACKPLANE", "postgres");
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("REDIS_REST_URL", "");
    vi.stubEnv("REDIS_REST_TOKEN", "");

    expect(
      getMediaWorkerCapabilities().capabilities.find(({ id }) => id === "worker-queue")?.status,
    ).toBe("available");
    expect(
      (await probeMediaWorkerCapabilities()).capabilities.find(({ id }) => id === "worker-queue")
        ?.status,
    ).toBe("available");
    expect(
      getSystemCapabilities().capabilities.find(({ id }) => id === "multiplayer-realtime")?.status,
    ).toBe("available");
  });

  it("rejects an incomplete Postgres worker configuration", () => {
    vi.stubEnv("MEDIA_PROCESSOR_MODE", "hybrid");
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    vi.stubEnv("TRANSFER_CATALOGUE_STORE", "postgres");
    vi.stubEnv("MEDIA_WORKER_STATUS_STORE", "");
    expect(
      getMediaWorkerCapabilities().capabilities.find(({ id }) => id === "worker-queue")?.status,
    ).toBe("unavailable");
  });
});
