import { runMigrations } from "@/lib/platform/migrations.server";
import { closePool, isDatabaseConfigured } from "@/lib/platform/postgres.server";

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required");
  try {
    const result = await runMigrations();
    console.log(
      JSON.stringify({
        event: "postgres.migrations.complete",
        applied: result.applied,
        alreadyApplied: result.alreadyApplied,
      }),
    );
  } finally {
    await closePool();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database migration failed");
  process.exitCode = 1;
});
