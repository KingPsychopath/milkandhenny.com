type DatabaseBootState =
  | { status: "pending" | "migrating" | "ready" }
  | { status: "failed"; reason: string };

let state: DatabaseBootState = { status: "pending" };

export function markDatabaseMigrationsStarted(): void {
  state = { status: "migrating" };
}

export function markDatabaseReady(): void {
  state = { status: "ready" };
}

export function markDatabaseFailed(error: unknown): void {
  state = {
    status: "failed",
    reason: error instanceof Error ? error.name : "MigrationError",
  };
}

export function getDatabaseBootState(): DatabaseBootState {
  return state;
}

export function resetDatabaseBootStateForTests(): void {
  state = { status: "pending" };
}
