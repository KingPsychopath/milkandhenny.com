import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const transferId = "transfer-capability-one";
const otherId = "transfer-capability-two";
const tokenHash = "a".repeat(64);

async function insertTransfer(id: string) {
  await query(
    `insert into transfers
       (id, title, delete_token_hash, delete_token_ciphertext, delete_token_nonce,
        created_at, expires_at)
     values ($1,'Test transfer',$2,decode('00','hex'),decode('000000000000000000000000','hex'),
             now(),now()+interval '7 days')`,
    [id, tokenHash],
  );
}

async function insertFile(transfer: string, id: string, position = 0) {
  await query(
    `insert into transfer_files
       (transfer_id,id,position,filename,kind,size_bytes,mime_type,storage_key)
     values ($1,$2,$3,$2,'image',10,'image/jpeg',$4)`,
    [transfer, id, position, `transfers/${transfer}/${id}`],
  );
}

describeWithDatabase("transfer catalogue and media-job schema", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await query("truncate transfer_upload_reservations, transfers cascade");
  });

  it("binds group members and media jobs to files in the same transfer", async () => {
    await insertTransfer(transferId);
    await insertTransfer(otherId);
    await insertFile(transferId, "one");
    await insertFile(otherId, "two");
    await query("insert into transfer_groups (transfer_id,id,type) values ($1,'pair','raw_pair')", [
      transferId,
    ]);
    await expect(
      query(
        `insert into transfer_group_members
           (transfer_id,group_id,file_id,role,mime_type)
         values ($1,'pair','two','raw','image/x-raw')`,
        [transferId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      query(
        `insert into transfer_media_jobs
           (id,transfer_id,file_id,operation,generation,idempotency_key,payload,enqueued_at)
         values ($1,$2,'two','preview',1,'job-cross','{}',now())`,
        [randomUUID(), transferId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await query(
      `insert into transfer_group_members
         (transfer_id,group_id,file_id,role,mime_type)
       values ($1,'pair','one','primary','image/jpeg')`,
      [transferId],
    );
  });

  it("refuses duplicate job identities and incomplete claims", async () => {
    await insertTransfer(transferId);
    await insertFile(transferId, "one");
    await query(
      `insert into transfer_media_jobs
         (id,transfer_id,file_id,operation,generation,idempotency_key,payload,enqueued_at)
       values ($1,$2,'one','preview',1,'job-one','{}',now())`,
      [randomUUID(), transferId],
    );
    await expect(
      query(
        `insert into transfer_media_jobs
           (id,transfer_id,file_id,operation,generation,idempotency_key,payload,enqueued_at)
         values ($1,$2,'one','preview',1,'job-two','{}',now())`,
        [randomUUID(), transferId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      query("update transfer_media_jobs set status='claimed' where idempotency_key='job-one'"),
    ).rejects.toMatchObject({ code: "23514" });
    await query(
      `update transfer_media_jobs
          set status='claimed', claim_token=$1, claim_owner='worker',
              lease_until=now()+interval '1 minute'
        where idempotency_key='job-one'`,
      [randomUUID()],
    );
  });

  it("retains presign reservations before a transfer exists and rejects invalid lifetimes", async () => {
    await query(
      `insert into transfer_upload_reservations
         (transfer_id,delete_token_hash,actor_jti_hash,files_fingerprint_sha256,
          reserved_file_count,reserved_bytes,expires_seconds,created_at,expires_at)
       values ($1,$2,$2,$2,2,2048,3600,now(),now()+interval '1 hour')`,
      [transferId, tokenHash],
    );
    expect(
      await query<{ count: string }>(
        "select count(*)::text as count from transfer_upload_reservations",
      ),
    ).toEqual([{ count: "1" }]);
    await expect(
      query(
        `insert into transfers
           (id,title,delete_token_hash,delete_token_ciphertext,delete_token_nonce,
            created_at,expires_at)
         values ($1,'Expired',$2,decode('00','hex'),decode('000000000000000000000000','hex'),
                 now(),now()-interval '1 second')`,
        [transferId, tokenHash],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
