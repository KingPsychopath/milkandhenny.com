import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { createPostgresTransfer } from "@/features/transfers/catalogue-postgres.server";
import {
  closeTransferMediaEventSubscriber,
  publishTransferMediaEvent,
  subscribeToTransferMediaEvents,
} from "@/features/transfers/media-events.server";
import type { TransferData } from "@/features/transfers/types";
import { query } from "@/lib/platform/postgres.server";
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
});
