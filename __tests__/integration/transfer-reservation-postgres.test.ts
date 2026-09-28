import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  cleanupPostgresTransferUploadReservations,
  createPostgresTransferUploadReservation,
  deletePostgresTransferUploadReservation,
  getPostgresTransferUploadReservation,
  matchesPostgresTransferUploadReservation,
} from "@/features/transfers/upload-reservation-postgres.server";
import { transferUploadFilesFingerprint } from "@/features/transfers/upload-reservation.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const files = [
  { name: "photo.jpg", mediaId: "photo", size: 100, originalSize: 20 },
  { name: "video.mp4", mediaId: "video", size: 200 },
];
const source = {
  transferId: "reservation-capability",
  deleteToken: "private-delete-token",
  actorJti: "private-actor-jti",
  expiresSeconds: 3600,
  filesFingerprint: transferUploadFilesFingerprint(files),
  createdAt: "2026-09-26T18:00:00.000Z",
};

describeWithDatabase("Postgres transfer upload reservation", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await query("truncate transfer_upload_reservations, transfers cascade");
  });

  it("admits one concurrent reservation and checks credentials without storing plaintext", async () => {
    const created = await Promise.all(
      Array.from({ length: 2 }, () => createPostgresTransferUploadReservation(source, files)),
    );
    expect(created.sort()).toEqual([false, true]);
    const reservation = await getPostgresTransferUploadReservation(source.transferId);
    expect(reservation).toMatchObject({ reservedFileCount: 2, reservedBytes: 320 });
    if (!reservation) throw new Error("Expected reservation");
    expect(matchesPostgresTransferUploadReservation(reservation, source)).toBe(true);
    expect(
      matchesPostgresTransferUploadReservation(reservation, {
        ...source,
        deleteToken: "wrong-delete-token",
      }),
    ).toBe(false);
    expect(
      matchesPostgresTransferUploadReservation(reservation, {
        ...source,
        actorJti: "wrong-actor",
      }),
    ).toBe(false);
    expect(
      matchesPostgresTransferUploadReservation(reservation, {
        ...source,
        filesFingerprint: "wrong-files",
      }),
    ).toBe(false);
    const stored = await query<{
      delete_token_hash: string;
      actor_jti_hash: string;
      files_fingerprint_sha256: string;
    }>(
      `select delete_token_hash, actor_jti_hash, files_fingerprint_sha256
         from transfer_upload_reservations where transfer_id=$1`,
      [source.transferId],
    );
    expect(Object.values(stored[0] ?? {}).every((value) => /^[a-f0-9]{64}$/.test(value))).toBe(
      true,
    );
    expect(JSON.stringify(stored)).not.toContain(source.deleteToken);
    expect(JSON.stringify(stored)).not.toContain(source.actorJti);
  });

  it("hides expired reservations, cleans them in batches and permits deletion", async () => {
    expect(await createPostgresTransferUploadReservation(source, files)).toBe(true);
    await query(
      "update transfer_upload_reservations set expires_at=now()-interval '1 second' where transfer_id=$1",
      [source.transferId],
    );
    expect(await getPostgresTransferUploadReservation(source.transferId)).toBeNull();
    expect(await cleanupPostgresTransferUploadReservations(1)).toBe(1);
    expect(await createPostgresTransferUploadReservation(source, files)).toBe(true);
    await deletePostgresTransferUploadReservation(source.transferId);
    expect(await getPostgresTransferUploadReservation(source.transferId)).toBeNull();
  });

  it("rejects a selection fingerprint that does not match its file set", async () => {
    await expect(
      createPostgresTransferUploadReservation({ ...source, filesFingerprint: "wrong" }, files),
    ).rejects.toThrow("Invalid transfer reservation");
    await expect(
      createPostgresTransferUploadReservation(source, [{ ...files[0], size: -1 }]),
    ).rejects.toThrow("Invalid transfer reservation");
  });
});
