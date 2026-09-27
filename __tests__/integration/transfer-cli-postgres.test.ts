import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { getPostgresTransfer } from "@/features/transfers/catalogue-postgres.server";
import { disposeMediaWorkerRuntime } from "@/features/system/media-worker-runtime.server";
import { r2ObjectStorageProvider } from "@/lib/platform/object-storage-provider-context.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

vi.mock("../../scripts/r2-client", () => ({ isTransferStorageConfigured: () => true }));

describeWithDatabase("Postgres transfer CLI", () => {
  beforeAll(applySchema);
  afterAll(async () => {
    await disposeMediaWorkerRuntime();
    await closeDatabase();
  });
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-transfer-secret-at-least-32-bytes");
    vi.stubEnv("TRANSFER_CATALOGUE_STORE", "postgres");
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    vi.stubEnv("REDIS_REST_URL", "");
    vi.stubEnv("REDIS_REST_TOKEN", "");
    await query("truncate transfers cascade");
    vi.spyOn(r2ObjectStorageProvider, "presignPutUrl").mockResolvedValue(
      "https://upload.invalid/object",
    );
    vi.spyOn(r2ObjectStorageProvider, "headObject").mockResolvedValue({ exists: true, size: 3 });
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates and appends through Postgres reservations with no Redis client", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mah-transfer-cli-"));
    try {
      fs.writeFileSync(path.join(dir, "one.txt"), "one");
      const { createTransfer, appendToTransfer } = await import("../../scripts/transfer-ops");
      const created = await createTransfer({ dir, title: "CLI transfer", expires: "1h" });
      expect((await getPostgresTransfer(created.transfer.id))?.files).toMatchObject([
        { filename: "one.txt", processingStatus: "skipped" },
      ]);
      expect(fs.existsSync(path.join(dir, ".mah-transfer-postgres-upload.checkpoint.json"))).toBe(
        false,
      );

      fs.rmSync(path.join(dir, "one.txt"));
      fs.writeFileSync(path.join(dir, "two.txt"), "two");
      const appended = await appendToTransfer({ id: created.transfer.id, dir });
      expect(appended.addedCount).toBe(1);
      expect(
        (await getPostgresTransfer(created.transfer.id))?.files.map((file) => file.filename),
      ).toEqual(["one.txt", "two.txt"]);
      expect(
        fs.existsSync(
          path.join(dir, `.mah-transfer-postgres-append.${created.transfer.id}.checkpoint.json`),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
