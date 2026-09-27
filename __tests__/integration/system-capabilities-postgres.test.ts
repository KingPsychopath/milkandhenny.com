import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import {
  getMediaWorkerCapabilities,
  getSystemCapabilities,
  probeMediaWorkerCapabilities,
  probeSystemCapabilities,
} from "@/features/system/capabilities.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";
import { disposeMultiplayerRuntime } from "@/features/things/shared/multiplayer-runtime.server";

describeWithDatabase("Postgres operational capabilities", () => {
  beforeAll(applySchema);
  afterAll(async () => {
    await disposeMultiplayerRuntime();
    await closeDatabase();
  });
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

  it("probes application persistence through Postgres only when all stores have moved", async () => {
    for (const name of [
      "ALBUM_STORE",
      "ATTENDEE_SESSION_STORE",
      "AUTH_CLI_STORE",
      "AUTH_TOKEN_STORE",
      "BEST_DRESSED_STORE",
      "CENTRE_ROOM_STORE",
      "DRAW_COUNTRY_ROOM_STORE",
      "FAMILY_FEUD_ROOM_STORE",
      "GAME_POOL_CREDENTIAL_STORE",
      "HOT_AND_COLD_ROOM_STORE",
      "LIARS_ROOM_STORE",
      "MEDIA_WORKER_STATUS_STORE",
      "MULTIPLAYER_REALTIME_BACKPLANE",
      "OFFICIAL_GAME_RESULT_OUTBOX_STORE",
      "PAIRED_GAME_ROOM_STORE",
      "PASSKEY_CEREMONY_STORE",
      "PITCH_PRESENTATION_STORE",
      "RATE_LIMIT_STORE",
      "REPORT_STORE",
      "SAME_BRAIN_ROOM_STORE",
      "SPELLING_PARTY_ROOM_STORE",
      "TRANSFER_CATALOGUE_STORE",
      "TRANSFER_MEDIA_EVENT_BACKPLANE",
      "TRANSFER_MEDIA_JOB_STORE",
      "TRANSFER_OBJECT_DELETION_RUNNER",
      "TWIN_ROOM_STORE",
      "UPLOAD_ACCESS_STORE",
      "WORD_SHARE_STORE",
      "WORD_STORE",
    ])
      vi.stubEnv(name, "postgres");
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("REDIS_REST_URL", "");
    vi.stubEnv("REDIS_REST_TOKEN", "");
    expect(
      getSystemCapabilities().capabilities.find(({ id }) => id === "persistence"),
    ).toMatchObject({ status: "available", detail: "Postgres application stores are configured." });
    expect(
      (await probeSystemCapabilities()).capabilities.find(({ id }) => id === "persistence"),
    ).toMatchObject({ status: "available", detail: "Postgres application stores are reachable." });
    vi.stubEnv("LIARS_ROOM_STORE", "");
    expect(
      getSystemCapabilities().capabilities.find(({ id }) => id === "persistence")?.status,
    ).toBe("unavailable");
  });
});
