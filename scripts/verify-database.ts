import { verifyMigrations } from "@/lib/platform/migrations.server";
import { closePool, isDatabaseConfigured } from "@/lib/platform/postgres.server";

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required");
  try {
    const result = await verifyMigrations();
    console.log(
      JSON.stringify({
        event: "postgres.migrations.verified",
        alreadyApplied: result.alreadyApplied,
      }),
    );
  } finally {
    await closePool();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database verification failed");
  process.exitCode = 1;
});
