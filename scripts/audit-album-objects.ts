import { auditPostgresAlbumObjects } from "@/features/media/album-object-audit.server";
import { isConfigured } from "@/lib/platform/object-storage-provider-context.server";
import { closePool, isDatabaseConfigured } from "@/lib/platform/postgres.server";

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required");
  if (!isConfigured()) throw new Error("Private and public object storage are required");
  try {
    const result = await auditPostgresAlbumObjects();
    console.log(JSON.stringify({ event: "albums.objects.audited", ...result }));
    if (!result.complete || result.issues.length > 0) process.exitCode = 1;
  } finally {
    await closePool();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Album object audit failed");
  process.exitCode = 1;
});
