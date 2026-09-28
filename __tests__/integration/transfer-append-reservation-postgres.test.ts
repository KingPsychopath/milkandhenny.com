import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  cleanupPostgresTransferAppendReservations,
  reservePostgresTransferAppend,
} from "@/features/transfers/append-reservation-postgres.server";
import {
  appendPostgresTransferFiles,
  createPostgresTransfer,
  finalizePostgresTransferAppend,
  getPostgresTransfer,
} from "@/features/transfers/catalogue-postgres.server";
import type { TransferData } from "@/features/transfers/types";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const transfer: TransferData = {
  id: "append-reserve-transfer-one",
  title: "Append reservation",
  deleteToken: "private-token",
  createdAt: "2026-09-26T18:00:00.000Z",
  expiresAt: "2026-10-03T18:00:00.000Z",
  files: [
    {
      id: "existing",
      filename: "existing.jpg",
      kind: "image",
      size: 100,
      mimeType: "image/jpeg",
      storageKey: "transfers/append-reserve-transfer-one/originals/existing.jpg",
    },
  ],
};

function file(id: string, size = 50) {
  return { mediaId: id, name: `${id}.jpg`, size };
}

function storedFile(id: string, size = 50) {
  return {
    id,
    filename: `${id}.jpg`,
    kind: "image" as const,
    size,
    mimeType: "image/jpeg",
    storageKey: `transfers/${transfer.id}/originals/${id}.jpg`,
  };
}

describeWithDatabase("Postgres transfer append reservation", () => {
  beforeAll(applySchema);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-transfer-secret-at-least-32-bytes");
    await query("truncate transfers cascade");
    await createPostgresTransfer(transfer);
  });

  it("serializes independent batches against outstanding file and byte capacity", async () => {
    const outcomes = await Promise.all([
      reservePostgresTransferAppend(transfer.id, [file("a")], {
        maxFiles: 2,
        maxTotalBytes: 150,
      }),
      reservePostgresTransferAppend(transfer.id, [file("b")], {
        maxFiles: 2,
        maxTotalBytes: 150,
      }),
    ]);
    expect(outcomes.sort()).toEqual(["limit", "reserved"]);
    const rows = await query<{ reserved_file_count: number; reserved_bytes: string }>(
      "select reserved_file_count,reserved_bytes::text from transfer_append_reservations",
    );
    expect(rows).toEqual([{ reserved_file_count: 1, reserved_bytes: "50" }]);
  });

  it("is idempotent for the same selection and rejects overlapping IDs or names", async () => {
    expect(await reservePostgresTransferAppend(transfer.id, [file("a")])).toBe("reserved");
    expect(await reservePostgresTransferAppend(transfer.id, [file("a")])).toBe("reserved");
    expect(await reservePostgresTransferAppend(transfer.id, [{ ...file("b"), mediaId: "a" }])).toBe(
      "conflict",
    );
    expect(
      await reservePostgresTransferAppend(transfer.id, [{ ...file("a"), mediaId: "new-id" }]),
    ).toBe("conflict");
    expect(await reservePostgresTransferAppend(transfer.id, [file("existing")])).toBe("conflict");
    expect(await reservePostgresTransferAppend(transfer.id, [file("independent")])).toBe(
      "reserved",
    );
    const rows = await query<{ count: string }>(
      "select count(*)::text as count from transfer_append_reservations",
    );
    expect(rows[0].count).toBe("2");
  });

  it("releases expired capacity and cleans orphaned reservations", async () => {
    expect(await reservePostgresTransferAppend(transfer.id, [file("a")])).toBe("reserved");
    await query(
      `update transfer_append_reservations
          set created_at=now()-interval '2 seconds',expires_at=now()-interval '1 second'`,
    );
    expect(await cleanupPostgresTransferAppendReservations(1)).toBe(1);
    expect(await reservePostgresTransferAppend(transfer.id, [file("a")])).toBe("reserved");
  });

  it("finalizes one batch while preserving capacity reserved by another", async () => {
    const limits = { maxFiles: 3, maxTotalBytes: 200 };
    expect(await reservePostgresTransferAppend(transfer.id, [file("a")], limits)).toBe("reserved");
    expect(await reservePostgresTransferAppend(transfer.id, [file("b")], limits)).toBe("reserved");
    expect(
      await finalizePostgresTransferAppend(transfer.id, [file("a")], [storedFile("wrong")], limits),
    ).toEqual({ status: "reservation-mismatch" });
    expect(await appendPostgresTransferFiles(transfer.id, [storedFile("c")], limits)).toEqual({
      status: "limit",
    });
    expect(
      await finalizePostgresTransferAppend(transfer.id, [file("a")], [storedFile("a")], limits),
    ).toMatchObject({ status: "updated" });
    expect(
      await finalizePostgresTransferAppend(transfer.id, [file("a")], [storedFile("a")], limits),
    ).toEqual({ status: "missing-reservation" });
    expect(
      await finalizePostgresTransferAppend(transfer.id, [file("b")], [storedFile("b")], limits),
    ).toMatchObject({ status: "updated" });
    expect((await getPostgresTransfer(transfer.id))?.files.map((item) => item.id)).toEqual([
      "existing",
      "a",
      "b",
    ]);
    const rows = await query<{ count: string }>(
      "select count(*)::text as count from transfer_append_reservations",
    );
    expect(rows[0].count).toBe("0");
  });

  it("admits one concurrent finalization and refuses an oversized inspected result", async () => {
    expect(await reservePostgresTransferAppend(transfer.id, [file("a")])).toBe("reserved");
    expect(
      await finalizePostgresTransferAppend(transfer.id, [file("a")], [storedFile("a", 51)]),
    ).toEqual({ status: "reservation-mismatch" });
    const results = await Promise.all([
      finalizePostgresTransferAppend(transfer.id, [file("a")], [storedFile("a")]),
      finalizePostgresTransferAppend(transfer.id, [file("a")], [storedFile("a")]),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "missing-reservation",
      "updated",
    ]);
    expect((await getPostgresTransfer(transfer.id))?.files).toHaveLength(2);
  });
});
