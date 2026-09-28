import { headObject } from "@/lib/platform/object-storage-provider-context.server";
import { query } from "@/lib/platform/postgres.server";

type SourceRow = {
  transfer_id: string;
  file_id: string;
  storage_key: string;
  size_bytes: string;
  stored_bytes: string | null;
  original_storage_key: string | null;
};

export type TransferSourceIssue = {
  transferId: string;
  fileId: string;
  key: string;
  kind: "missing" | "size_mismatch" | "size_unverified";
  expectedBytes?: number;
  actualBytes?: number;
};

export type TransferSourceAudit = {
  filesChecked: number;
  objectsChecked: number;
  complete: boolean;
  issues: TransferSourceIssue[];
};

/** Read-only, bounded release check. Unknown R2 failures abort instead of looking like absence. */
export async function auditPostgresTransferSources(limit = 1_000): Promise<TransferSourceAudit> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
    throw new Error("Invalid transfer source audit limit");
  const rows = await query<SourceRow>(
    `select f.transfer_id,f.id as file_id,f.storage_key,f.size_bytes::text,
            f.stored_bytes::text,
            f.original_storage_key
       from transfer_files f join transfers t on t.id=f.transfer_id
      where t.deleted_at is null and t.expires_at > clock_timestamp()
      order by f.transfer_id,f.id limit $1`,
    [limit + 1],
  );
  const complete = rows.length <= limit;
  const files = rows.slice(0, limit);
  const issues: TransferSourceIssue[] = [];
  let objectsChecked = 0;
  for (let index = 0; index < files.length; index += 4) {
    const batch = files.slice(index, index + 4);
    const results = await Promise.all(
      batch.map(async (file) => {
        const originalBytes =
          file.original_storage_key &&
          file.original_storage_key !== file.storage_key &&
          file.stored_bytes !== null
            ? String(BigInt(file.stored_bytes) - BigInt(file.size_bytes))
            : null;
        const objects = [
          { key: file.storage_key, expectedBytes: file.size_bytes },
          ...(file.original_storage_key && file.original_storage_key !== file.storage_key
            ? [{ key: file.original_storage_key, expectedBytes: originalBytes }]
            : []),
        ];
        return Promise.all(
          objects.map(async ({ key, expectedBytes }) => ({
            key,
            expectedBytes,
            metadata: await headObject(key, { scope: "private" }),
          })),
        );
      }),
    );
    for (let fileIndex = 0; fileIndex < batch.length; fileIndex++) {
      const file = batch[fileIndex];
      for (const object of results[fileIndex]) {
        objectsChecked += 1;
        if (!object.metadata.exists) {
          issues.push({
            transferId: file.transfer_id,
            fileId: file.file_id,
            key: object.key,
            kind: "missing",
          });
          continue;
        }
        if (object.expectedBytes !== null) {
          const expectedBytes = Number(object.expectedBytes);
          if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)
            throw new Error("Invalid stored transfer object size");
          if (object.metadata.size === undefined)
            issues.push({
              transferId: file.transfer_id,
              fileId: file.file_id,
              key: object.key,
              kind: "size_unverified",
              expectedBytes,
            });
          else if (object.metadata.size !== expectedBytes)
            issues.push({
              transferId: file.transfer_id,
              fileId: file.file_id,
              key: object.key,
              kind: "size_mismatch",
              expectedBytes,
              actualBytes: object.metadata.size,
            });
        }
      }
    }
  }
  return { filesChecked: files.length, objectsChecked, complete, issues };
}
