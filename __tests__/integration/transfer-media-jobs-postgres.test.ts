import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { createPostgresTransfer } from "@/features/transfers/catalogue-postgres.server";
import {
  cancelObsoletePostgresTransferMediaJobs,
  claimPostgresTransferMediaJobs,
  completePostgresTransferMediaJob,
  enqueueAbandonedPostgresTransferMediaOutputs,
  enqueuePostgresTransferMediaJob,
  failPostgresTransferMediaJob,
  getPostgresTransferMediaQueueSnapshot,
  renewPostgresTransferMediaJob,
  retryDeadPostgresTransferMediaJobs,
} from "@/features/transfers/media-jobs-postgres.server";
import type { TransferMediaJob } from "@/features/transfers/media-queue.server";
import {
  describeTransferMediaQueue,
  enqueueTransferMediaJob,
  getTransferMediaQueueLength,
  retryDeadTransferMediaJobs,
} from "@/features/transfers/media-queue.server";
import { getGenerationTransferAssetKeys } from "@/features/transfers/media-state";
import type { TransferData } from "@/features/transfers/types";
import { query, transaction } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const transfer: TransferData = {
  id: "queue-capability-one",
  title: "Queued transfer",
  deleteToken: "private-delete-token",
  createdAt: "2026-09-26T18:00:00.000Z",
  expiresAt: "2026-10-03T18:00:00.000Z",
  files: [
    {
      id: "raw-one",
      filename: "raw-one.dng",
      kind: "image",
      size: 100,
      mimeType: "image/x-adobe-dng",
      storageKey: "transfers/queue-capability-one/original/raw-one.dng",
      processingStatus: "queued",
    },
    {
      id: "raw-two",
      filename: "raw-two.dng",
      kind: "image",
      size: 100,
      mimeType: "image/x-adobe-dng",
      storageKey: "transfers/queue-capability-one/original/raw-two.dng",
      processingStatus: "queued",
    },
  ],
};

function job(id: string): TransferMediaJob {
  const expected = getGenerationTransferAssetKeys(transfer.id, `${id}.dng`, "worker_raw", id, 1);
  return {
    transferId: transfer.id,
    file: { name: `${id}.dng`, mediaId: id, size: 100 },
    mediaId: id,
    storageKey: `transfers/${transfer.id}/original/${id}.dng`,
    mimeType: "image/x-adobe-dng",
    processingRoute: "worker_raw",
    expectedThumbKey: expected.thumbKey,
    expectedFullKey: expected.fullKey,
    attempt: 1,
    enqueuedAt: "2026-09-26T18:01:00.000Z",
  };
}

describeWithDatabase("Postgres transfer media jobs", () => {
  beforeAll(applySchema);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-transfer-secret-at-least-32-bytes");
    await query("truncate transfers cascade");
    await query("truncate media_object_operations");
    await createPostgresTransfer(transfer);
  });

  it("enqueues with source state and refuses a conflicting replay", async () => {
    await expect(
      transaction((client) =>
        enqueuePostgresTransferMediaJob(
          client,
          { ...job("raw-one"), expectedThumbKey: `transfers/${transfer.id}/thumb/raw-one.webp` },
          1,
        ),
      ),
    ).rejects.toThrow("Transfer media job output generation is invalid");
    await expect(
      transaction(async (client) => {
        await enqueuePostgresTransferMediaJob(client, job("raw-one"), 1);
        throw new Error("source rolled back");
      }),
    ).rejects.toThrow("source rolled back");
    expect(
      await query<{ count: string }>("select count(*)::text as count from transfer_media_jobs"),
    ).toEqual([{ count: "0" }]);
    const id = await transaction((client) =>
      enqueuePostgresTransferMediaJob(client, job("raw-one"), 1),
    );
    expect(
      await transaction((client) => enqueuePostgresTransferMediaJob(client, job("raw-one"), 1)),
    ).toBe(id);
    await expect(
      transaction((client) =>
        enqueuePostgresTransferMediaJob(client, { ...job("raw-one"), mimeType: "changed-type" }, 1),
      ),
    ).rejects.toThrow("Conflicting transfer media job identity");
  });

  it("claims disjoint jobs and fences an expired worker", async () => {
    await transaction(async (client) => {
      await enqueuePostgresTransferMediaJob(client, job("raw-one"), 1);
      await enqueuePostgresTransferMediaJob(client, job("raw-two"), 1);
    });
    const [first, second] = await Promise.all([
      claimPostgresTransferMediaJobs("worker-one"),
      claimPostgresTransferMediaJobs("worker-two"),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.id).not.toBe(second[0]?.id);
    expect(first[0]?.job.expectedThumbKey).toContain(`/${first[0]?.claimToken}.webp`);
    const old = first[0];
    if (!old) throw new Error("Expected first claim");
    await query(
      "update transfer_media_jobs set lease_until=now()-interval '1 second' where id=$1",
      [old.id],
    );
    const recovered = (await claimPostgresTransferMediaJobs("worker-three"))[0];
    expect(recovered?.id).toBe(old.id);
    expect(recovered?.claimToken).not.toBe(old.claimToken);
    expect(recovered?.job.expectedThumbKey).not.toBe(old.job.expectedThumbKey);
    expect(
      await query<{ count: string }>(
        "select count(*)::text as count from transfer_media_job_attempt_outputs where job_id=$1",
        [old.id],
      ),
    ).toEqual([{ count: "2" }]);
    expect(await renewPostgresTransferMediaJob(old.id, old.claimToken)).toBe(false);
    expect(
      await transaction((client) =>
        completePostgresTransferMediaJob(client, old.id, old.claimToken, null),
      ),
    ).toBe(false);
    const sourceFile = transfer.files.find((file) => file.id === recovered?.job.mediaId);
    if (!sourceFile) throw new Error("Expected source file");
    await expect(
      transaction((client) =>
        completePostgresTransferMediaJob(client, recovered!.id, recovered!.claimToken, {
          ...sourceFile,
          id: "wrong-file",
          processingStatus: "worker_done",
        }),
      ),
    ).rejects.toThrow("Transfer media result does not match claimed source");
    expect(
      await transaction((client) =>
        completePostgresTransferMediaJob(client, recovered!.id, recovered!.claimToken, {
          ...sourceFile,
          processingStatus: "worker_done",
          previewStatus: "ready",
          processingBackend: "worker",
        }),
      ),
    ).toBe(true);
    expect(
      await query<{
        processing_status: string;
        derivative_generation: number;
        derivative_claim_token: string;
      }>(
        "select processing_status,derivative_generation,derivative_claim_token from transfer_files where transfer_id=$1 and id=$2",
        [transfer.id, sourceFile.id],
      ),
    ).toEqual([
      {
        processing_status: "worker_done",
        derivative_generation: 1,
        derivative_claim_token: recovered!.claimToken,
      },
    ]);
  });

  it("dead-letters exhausted retries and cancels a superseded generation", async () => {
    const id = await transaction((client) =>
      enqueuePostgresTransferMediaJob(client, job("raw-one"), 1),
    );
    await query("update transfer_media_jobs set max_attempts=2 where id=$1", [id]);
    const first = (await claimPostgresTransferMediaJobs("worker-one"))[0];
    if (!first) throw new Error("Expected claim");
    expect(await failPostgresTransferMediaJob(id, first.claimToken, "processing_failed", 0)).toBe(
      true,
    );
    const second = (await claimPostgresTransferMediaJobs("worker-two"))[0];
    if (!second) throw new Error("Expected retry");
    expect(second.job.deliveryAttempt).toBe(1);
    expect(await failPostgresTransferMediaJob(id, second.claimToken, "processing_failed", 0)).toBe(
      true,
    );
    expect(await claimPostgresTransferMediaJobs("worker-three")).toEqual([]);
    expect(
      await query<{ status: string }>("select status from transfer_media_jobs where id=$1", [id]),
    ).toEqual([{ status: "dead" }]);

    await transaction((client) => enqueuePostgresTransferMediaJob(client, job("raw-two"), 1));
    const obsolete = (await claimPostgresTransferMediaJobs("worker-four"))[0];
    if (!obsolete) throw new Error("Expected obsolete claim");
    await query(
      "update transfer_files set processing_generation=2 where transfer_id=$1 and id='raw-two'",
      [transfer.id],
    );
    expect(
      await transaction((client) =>
        completePostgresTransferMediaJob(client, obsolete.id, obsolete.claimToken, null),
      ),
    ).toBe(false);
    expect(await cancelObsoletePostgresTransferMediaJobs()).toBe(1);
    expect(await claimPostgresTransferMediaJobs("worker-five")).toEqual([]);
  });

  it("reports queue states and grants one explicit retry to a live dead job", async () => {
    vi.stubEnv("MEDIA_PROCESSOR_MODE", "hybrid");
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    const id = await transaction((client) =>
      enqueuePostgresTransferMediaJob(client, job("raw-one"), 1),
    );
    expect(await getPostgresTransferMediaQueueSnapshot()).toMatchObject({
      pending: 1,
      claimed: 0,
      dead: 0,
      due: 1,
    });
    expect(await getTransferMediaQueueLength()).toBe(1);
    expect(await describeTransferMediaQueue()).toMatchObject({
      queued: 1,
      leased: 0,
      permanentFailures: 0,
      durableWork: { available: true, pending: 1, processing: 0, failed: 0 },
    });
    await query("update transfer_media_jobs set max_attempts=1 where id=$1", [id]);
    const first = (await claimPostgresTransferMediaJobs("worker-one"))[0];
    if (!first) throw new Error("Expected claim");
    expect(await failPostgresTransferMediaJob(id, first.claimToken, "processing_failed", 0)).toBe(
      true,
    );
    expect(await getPostgresTransferMediaQueueSnapshot()).toMatchObject({
      pending: 0,
      claimed: 0,
      dead: 1,
      due: 0,
    });
    expect(await retryDeadTransferMediaJobs()).toBe(1);
    const retried = (await claimPostgresTransferMediaJobs("worker-two"))[0];
    expect(retried?.job.deliveryAttempt).toBe(1);
    expect(retried?.claimToken).not.toBe(first.claimToken);
    expect(await retryDeadPostgresTransferMediaJobs()).toBe(0);
    expect(
      await query<{ attempts: number; max_attempts: number }>(
        "select attempts,max_attempts from transfer_media_jobs where id=$1",
        [id],
      ),
    ).toEqual([{ attempts: 2, max_attempts: 2 }]);
  });

  it("refuses Redis-era enqueue when the Postgres worker store is selected", async () => {
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    await expect(enqueueTransferMediaJob(job("raw-one"))).rejects.toThrow(
      "must enqueue with their file transaction",
    );
  });

  it("does not retry a dead job after its source generation changes", async () => {
    const id = await transaction((client) =>
      enqueuePostgresTransferMediaJob(client, job("raw-one"), 1),
    );
    await query("update transfer_media_jobs set status='dead' where id=$1", [id]);
    await query(
      "update transfer_files set processing_generation=2 where transfer_id=$1 and id='raw-one'",
      [transfer.id],
    );
    expect(await retryDeadPostgresTransferMediaJobs()).toBe(0);
    expect(await getPostgresTransferMediaQueueSnapshot()).toMatchObject({ dead: 1, due: 0 });
  });

  it("stages deletion of abandoned attempt keys but preserves the published winner", async () => {
    await transaction((client) => enqueuePostgresTransferMediaJob(client, job("raw-one"), 1));
    const old = (await claimPostgresTransferMediaJobs("worker-one"))[0];
    if (!old) throw new Error("Expected first claim");
    await query("update transfer_media_jobs set lease_until=now()-interval '1 second'");
    const winner = (await claimPostgresTransferMediaJobs("worker-two"))[0];
    if (!winner) throw new Error("Expected replacement claim");
    await query("update transfer_media_job_attempt_outputs set created_at=now()-interval '1 hour'");
    expect(await enqueueAbandonedPostgresTransferMediaOutputs()).toBe(1);
    expect(
      await query<{ target_key: string }>(
        "select target_key from media_object_operations order by target_key",
      ),
    ).toEqual(
      [old.job.expectedThumbKey, old.job.expectedFullKey]
        .filter((key): key is string => Boolean(key))
        .sort()
        .map((target_key) => ({ target_key })),
    );
    const file = transfer.files.find((entry) => entry.id === winner.job.mediaId);
    if (!file) throw new Error("Expected winner source file");
    expect(
      await transaction((client) =>
        completePostgresTransferMediaJob(client, winner.id, winner.claimToken, {
          ...file,
          previewStatus: "ready",
          processingStatus: "worker_done",
        }),
      ),
    ).toBe(true);
    expect(await enqueueAbandonedPostgresTransferMediaOutputs()).toBe(0);
    expect(
      await query<{ count: string }>("select count(*)::text as count from media_object_operations"),
    ).toEqual([{ count: "2" }]);
  });
});
