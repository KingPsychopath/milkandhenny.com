import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, transaction } from "@/lib/platform/postgres.server";

export type ObjectScope = "private" | "public";
export type MediaObjectOperationInput = {
  ownerKind: "album" | "word";
  ownerId: string;
  ownerRevision: number;
  operation: "copy" | "delete";
  sourceScope?: ObjectScope;
  sourceKey?: string;
  targetScope: ObjectScope;
  targetKey: string;
  contentType?: string;
  cacheControl?: string;
};

type OperationRow = {
  id: string;
  owner_kind: MediaObjectOperationInput["ownerKind"];
  owner_id: string;
  owner_revision: number;
  operation: MediaObjectOperationInput["operation"];
  source_scope: ObjectScope | null;
  source_key: string | null;
  target_scope: ObjectScope;
  target_key: string;
  content_type: string | null;
  cache_control: string | null;
  status: "pending" | "claimed" | "completed" | "dead";
  attempts: number;
  max_attempts: number;
  claim_token: string | null;
  claim_owner: string | null;
  lease_until: Date | null;
};

export type ClaimedObjectOperation = {
  id: string;
  claimToken: string;
  ownerKind: MediaObjectOperationInput["ownerKind"];
  ownerId: string;
  ownerRevision: number;
  operation: MediaObjectOperationInput["operation"];
  sourceScope: ObjectScope | null;
  sourceKey: string | null;
  targetScope: ObjectScope;
  targetKey: string;
  contentType: string | null;
  cacheControl: string | null;
  attempt: number;
};

function validKey(key: string): boolean {
  return key.length > 0 && key.length <= 1024 && !key.startsWith("/") && !key.includes("..");
}

function validateInput(input: MediaObjectOperationInput): void {
  if (
    !input.ownerId ||
    !Number.isInteger(input.ownerRevision) ||
    input.ownerRevision < 1 ||
    !validKey(input.targetKey) ||
    (input.operation === "copy" &&
      (!input.sourceScope || !input.sourceKey || !validKey(input.sourceKey)))
  )
    throw new Error("Invalid media object operation");
}

/** Call inside the transaction that makes the corresponding owner revision durable. */
export async function enqueueMediaObjectOperation(
  client: PoolClient,
  input: MediaObjectOperationInput,
): Promise<string> {
  validateInput(input);
  const id = randomUUID();
  const values = [
    id,
    input.ownerKind,
    input.ownerId,
    input.ownerRevision,
    input.operation,
    input.sourceScope ?? null,
    input.sourceKey ?? null,
    input.targetScope,
    input.targetKey,
    input.contentType ?? null,
    input.cacheControl ?? null,
  ];
  const inserted = await client.query<{ id: string }>(
    `insert into media_object_operations
       (id, owner_kind, owner_id, owner_revision, operation, source_scope, source_key,
        target_scope, target_key, content_type, cache_control)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (owner_kind, owner_id, owner_revision, operation, target_scope, target_key)
       do nothing returning id`,
    values,
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const existing = await client.query<OperationRow>(
    `select * from media_object_operations
      where owner_kind=$1 and owner_id=$2 and owner_revision=$3
        and operation=$4 and target_scope=$5 and target_key=$6`,
    [
      input.ownerKind,
      input.ownerId,
      input.ownerRevision,
      input.operation,
      input.targetScope,
      input.targetKey,
    ],
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.source_scope !== (input.sourceScope ?? null) ||
    row.source_key !== (input.sourceKey ?? null) ||
    row.content_type !== (input.contentType ?? null) ||
    row.cache_control !== (input.cacheControl ?? null)
  )
    throw new Error("Conflicting media object operation identity");
  return row.id;
}

export async function claimMediaObjectOperations(
  claimOwner: string,
  limit = 10,
  leaseMs = 60_000,
): Promise<ClaimedObjectOperation[]> {
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(claimOwner) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isInteger(leaseMs) ||
    leaseMs < 1_000 ||
    leaseMs > 15 * 60_000
  )
    throw new Error("Invalid media operation claim parameters");
  return transaction(async (client) => {
    await client.query(
      `update media_object_operations
          set status='dead', claim_token=null, claim_owner=null, lease_until=null,
              updated_at=now(), last_error=coalesce(last_error, 'lease expired after final attempt')
        where status='claimed' and lease_until <= now() and attempts >= max_attempts`,
    );
    const picked = await client.query<OperationRow>(
      `select * from media_object_operations
        where ((status='pending' and available_at <= now()) or
               (status='claimed' and lease_until <= now()))
          and attempts < max_attempts
        order by available_at, id
        for update skip locked
        limit $1`,
      [limit],
    );
    const claimed: ClaimedObjectOperation[] = [];
    for (const row of picked.rows) {
      const claimToken = randomUUID();
      await client.query(
        `update media_object_operations
            set status='claimed', attempts=attempts+1, claim_token=$2,
                claim_owner=$3, lease_until=now()+($4::text || ' milliseconds')::interval,
                updated_at=now()
          where id=$1`,
        [row.id, claimToken, claimOwner, leaseMs],
      );
      claimed.push({
        id: row.id,
        claimToken,
        ownerKind: row.owner_kind,
        ownerId: row.owner_id,
        ownerRevision: row.owner_revision,
        operation: row.operation,
        sourceScope: row.source_scope,
        sourceKey: row.source_key,
        targetScope: row.target_scope,
        targetKey: row.target_key,
        contentType: row.content_type,
        cacheControl: row.cache_control,
        attempt: row.attempts + 1,
      });
    }
    return claimed;
  });
}

export async function renewMediaObjectOperation(
  id: string,
  claimToken: string,
  leaseMs = 60_000,
): Promise<boolean> {
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 15 * 60_000)
    throw new Error("Invalid media operation lease");
  const rows = await query<{ id: string }>(
    `update media_object_operations
        set lease_until=now()+($3::text || ' milliseconds')::interval,
            updated_at=now()
      where id=$1 and claim_token=$2 and status='claimed' and lease_until>now()
      returning id`,
    [id, claimToken, leaseMs],
  );
  return rows.length === 1;
}

export async function completeMediaObjectOperation(
  id: string,
  claimToken: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update media_object_operations
        set status='completed', claim_token=null, claim_owner=null, lease_until=null,
            completed_at=now(), updated_at=now(), last_error=null
      where id=$1 and claim_token=$2 and status='claimed' and lease_until>now()
      returning id`,
    [id, claimToken],
  );
  return rows.length === 1;
}

export async function failMediaObjectOperation(
  id: string,
  claimToken: string,
  errorCode: string,
  retryDelayMs: number,
): Promise<boolean> {
  if (!/^[a-z0-9_.-]{1,80}$/.test(errorCode))
    throw new Error("Media operation failure requires a bounded error code");
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 24 * 60 * 60_000)
    throw new Error("Invalid media operation retry delay");
  const rows = await query<{ id: string }>(
    `update media_object_operations
        set status=case when attempts >= max_attempts then 'dead' else 'pending' end,
            available_at=now()+($4::text || ' milliseconds')::interval,
            claim_token=null, claim_owner=null, lease_until=null,
            last_error=$3, updated_at=now()
      where id=$1 and claim_token=$2 and status='claimed' and lease_until>now()
      returning id`,
    [id, claimToken, errorCode, retryDelayMs],
  );
  return rows.length === 1;
}
