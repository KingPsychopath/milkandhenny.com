import { auditPostgresTransferSources } from "@/features/transfers/source-object-audit.server";
import { closePool, isDatabaseConfigured } from "@/lib/platform/postgres.server";
import { isPrivateStorageConfigured } from "@/lib/platform/object-storage-provider-context.server";

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required");
  if (!isPrivateStorageConfigured()) throw new Error("Private object storage is required");
  try {
    const result = await auditPostgresTransferSources();
    console.log(JSON.stringify({ event: "transfers.sources.audited", ...result }));
    if (!result.complete || result.issues.length > 0) process.exitCode = 1;
  } finally {
    await closePool();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Transfer source audit failed");
  process.exitCode = 1;
});
