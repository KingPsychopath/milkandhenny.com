import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  claimMediaObjectOperations,
  completeMediaObjectOperation,
  enqueueMediaObjectOperation,
  failMediaObjectOperation,
  renewMediaObjectOperation,
} from "@/features/media/object-operations.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const copy = {
  ownerKind: "album" as const,
  ownerId: "jazz-night",
  ownerRevision: 2,
  operation: "copy" as const,
  sourceScope: "private" as const,
  sourceKey: "albums/jazz-night/og/photo.jpg",
  targetScope: "public" as const,
  targetKey: "albums/jazz-night/og/photo.jpg",
  contentType: "image/jpeg",
};

describeWithDatabase("durable media object operations", () => {
  beforeAll(async () => {
    await applySchema();
  });
  afterAll(async () => {
    await closeDatabase();
  });
  beforeEach(async () => {
    await query("truncate media_object_operations");
  });

  it("commits with its owner transaction and refuses conflicting idempotency payloads", async () => {
    await expect(
      transaction(async (client) => {
        await enqueueMediaObjectOperation(client, copy);
        throw new Error("owner update failed");
      }),
    ).rejects.toThrow("owner update failed");
    expect(
      await query<{ count: string }>("select count(*)::text as count from media_object_operations"),
    ).toEqual([{ count: "0" }]);

    const id = await transaction((client) => enqueueMediaObjectOperation(client, copy));
    expect(await transaction((client) => enqueueMediaObjectOperation(client, copy))).toBe(id);
    await expect(
      transaction((client) =>
        enqueueMediaObjectOperation(client, { ...copy, sourceKey: "another-source" }),
      ),
    ).rejects.toThrow("Conflicting media object operation identity");
  });

  it("claims disjoint work, fences expired owners and retries a lost claim", async () => {
    await transaction(async (client) => {
      await enqueueMediaObjectOperation(client, copy);
      await enqueueMediaObjectOperation(client, {
        ...copy,
        operation: "delete",
        sourceScope: undefined,
        sourceKey: undefined,
        targetKey: "albums/jazz-night/og/old.jpg",
      });
    });
    const [first, second] = await Promise.all([
      claimMediaObjectOperations("worker-a", 1),
      claimMediaObjectOperations("worker-b", 1),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.id).not.toBe(second[0]?.id);
    const old = first[0];
    if (!old) throw new Error("Expected claim");
    expect(await renewMediaObjectOperation(old.id, old.claimToken, 60_000)).toBe(true);
    await query(
      "update media_object_operations set lease_until=now()-interval '1 second' where id=$1",
      [old.id],
    );
    const recovered = await claimMediaObjectOperations("worker-c", 1);
    expect(recovered[0]?.id).toBe(old.id);
    expect(recovered[0]?.claimToken).not.toBe(old.claimToken);
    expect(await completeMediaObjectOperation(old.id, old.claimToken)).toBe(false);
    expect(await completeMediaObjectOperation(old.id, recovered[0]!.claimToken)).toBe(true);
    expect(await completeMediaObjectOperation(second[0]!.id, second[0]!.claimToken)).toBe(true);
    expect(await claimMediaObjectOperations("worker-d")).toEqual([]);
  });

  it("marks exhausted retries dead and never reclaims them", async () => {
    const id = await transaction((client) => enqueueMediaObjectOperation(client, copy));
    await query("update media_object_operations set max_attempts=2 where id=$1", [id]);
    const first = (await claimMediaObjectOperations("worker-a"))[0];
    if (!first) throw new Error("Expected first claim");
    expect(await failMediaObjectOperation(id, first.claimToken, "copy_failed", 0)).toBe(true);
    const second = (await claimMediaObjectOperations("worker-b"))[0];
    if (!second) throw new Error("Expected second claim");
    expect(second.attempt).toBe(2);
    expect(await failMediaObjectOperation(id, second.claimToken, "copy_failed", 0)).toBe(true);
    expect(await claimMediaObjectOperations("worker-c")).toEqual([]);
    expect(
      await query<{ status: string; attempts: number }>(
        "select status, attempts from media_object_operations where id=$1",
        [id],
      ),
    ).toEqual([{ status: "dead", attempts: 2 }]);
  });
});
