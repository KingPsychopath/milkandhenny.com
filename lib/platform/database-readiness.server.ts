type DatabaseBootState =
  | { status: "pending" | "migrating" | "ready" }
  | { status: "failed"; reason: string };

const STATE_KEY = "__milkandhennyDatabaseBootState";

type RuntimeGlobal = typeof globalThis & {
  [STATE_KEY]?: DatabaseBootState;
};

function setState(state: DatabaseBootState): void {
  (globalThis as RuntimeGlobal)[STATE_KEY] = state;
}

export function markDatabaseMigrationsStarted(): void {
  setState({ status: "migrating" });
}

export function markDatabaseReady(): void {
  setState({ status: "ready" });
}

export function markDatabaseFailed(error: unknown): void {
  setState({
    status: "failed",
    reason: error instanceof Error ? error.name : "MigrationError",
  });
}

export function getDatabaseBootState(): DatabaseBootState {
  return (globalThis as RuntimeGlobal)[STATE_KEY] ?? { status: "pending" };
}

export function resetDatabaseBootStateForTests(): void {
  setState({ status: "pending" });
}
