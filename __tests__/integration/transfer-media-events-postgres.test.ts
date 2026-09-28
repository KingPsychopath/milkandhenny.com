import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { createPostgresTransfer } from "@/features/transfers/catalogue-postgres.server";
import {
  closeTransferMediaEventSubscriber,
  publishTransferMediaEvent,
  subscribeToTransferMediaEvents,
} from "@/features/transfers/media-events.server";
import type { TransferData } from "@/features/transfers/types";
import { getPool, query } from "@/lib/platform/postgres.server";
import { GET } from "@/src/routes/api/transfers/$id/events/route";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const file: TransferData["files"][number] = {
  id: "photo",
  filename: "photo.jpg",
  kind: "image",
  size: 100,
  mimeType: "image/jpeg",
  storageKey: "transfers/pg-events-transfer-1/original/photo.jpg",
  previewStatus: "ready",
  processingStatus: "local_done",
};

async function createTransfer() {
  const transfer: TransferData = {
    id: "pg-events-transfer-1",
    title: "Event test",
    deleteToken: "private-delete-token",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    files: [file],
    groups: [],
  };
  expect(await createPostgresTransfer(transfer)).toBe(true);
  return transfer;
}

describeWithDatabase("Postgres transfer media events", () => {
  beforeAll(applySchema);
  afterAll(async () => {
    await closeTransferMediaEventSubscriber();
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await closeTransferMediaEventSubscriber();
    vi.stubEnv("AUTH_SECRET", "integration-test-transfer-secret-at-least-32-bytes");
    vi.stubEnv("TRANSFER_CATALOGUE_STORE", "postgres");
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    vi.stubEnv("TRANSFER_MEDIA_EVENT_BACKPLANE", "postgres");
    await query("truncate transfers cascade");
  });

  it("delivers a cross-connection wake from the committed catalogue", async () => {
    const transfer = await createTransfer();
    let resolveEvent!: (value: { transferId: string; file: typeof file }) => void;
    const received = new Promise<{ transferId: string; file: typeof file }>((resolve) => {
      resolveEvent = resolve;
    });
    const unsubscribe = await subscribeToTransferMediaEvents(transfer.id, resolveEvent);
    try {
      await publishTransferMediaEvent(transfer.id, file);
      await expect(received).resolves.toMatchObject({
        transferId: transfer.id,
        file: { id: file.id, previewStatus: "ready" },
      });
    } finally {
      unsubscribe();
    }
  });

  it("reconciles file state when an SSE client reconnects after a missed wake", async () => {
    const transfer = await createTransfer();
    const abort = new AbortController();
    const response = await GET(
      new Request(`https://example.test/api/transfers/${transfer.id}/events`, {
        signal: abort.signal,
      }),
      { params: Promise.resolve({ id: transfer.id }) },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected event stream");
    try {
      const first = await reader.read();
      const second = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain(": connected");
      expect(new TextDecoder().decode(second.value)).toContain(`"id":"${file.id}"`);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });

  it("should refresh an existing listener after a database disconnect loses a wake", async () => {
    const transfer = await createTransfer();
    const received = vi.fn();
    const unsubscribe = await subscribeToTransferMediaEvents(transfer.id, received);
    try {
      const disconnected = await query<{ terminated: boolean }>(
        `select pg_terminate_backend(pid) as terminated from pg_stat_activity
          where datname=current_database() and query='listen transfer_media_events_v1'`,
      );
      expect(disconnected).toEqual([{ terminated: true }]);
      await query("update transfer_files set width=1920 where transfer_id=$1", [transfer.id]);
      // This wake occurs during the reconnect delay, before a new LISTEN exists.
      await publishTransferMediaEvent(transfer.id, file);
      await vi.waitFor(
        () =>
          expect(received).toHaveBeenCalledWith(
            expect.objectContaining({
              transferId: transfer.id,
              file: expect.objectContaining({ id: file.id, width: 1920 }),
            }),
          ),
        { timeout: 5_000 },
      );
    } finally {
      unsubscribe();
    }
  }, 10_000);

  it("should release the SSE checkout when a separately evaluated Media runtime shuts down", async () => {
    const transfer = await createTransfer();
    const pool = getPool();
    if (!pool) throw new Error("Expected test pool");
    const baseline = pool.totalCount - pool.idleCount;
    const unsubscribe = await subscribeToTransferMediaEvents(transfer.id, () => {});
    unsubscribe();
    expect(pool.totalCount - pool.idleCount).toBe(baseline + 1);

    // Nitro's shutdown plugin and SSR's SSE route evaluate separate module copies.
    vi.resetModules();
    const { disposeMediaWorkerRuntime } =
      await import("@/features/system/media-worker-runtime.server");
    await disposeMediaWorkerRuntime();
    expect(pool.totalCount - pool.idleCount).toBe(baseline);
    await expect(subscribeToTransferMediaEvents(transfer.id, () => {})).rejects.toThrow("closed");
  });
});
