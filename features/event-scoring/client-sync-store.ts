import type { PendingScoreCommand, ScoreSnapshot } from "./client-sync";

const DATABASE_NAME = "milk-henny-event-scoring";
const DATABASE_VERSION = 1;
const SNAPSHOTS = "snapshots";
const COMMANDS = "commands";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Browser storage failed")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("Browser storage was cancelled")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("Browser storage failed")),
      { once: true },
    );
  });
}

export class EventScoringClientStore {
  private database?: Promise<IDBDatabase>;
  private readonly channel =
    typeof BroadcastChannel === "undefined"
      ? undefined
      : new BroadcastChannel("event-scoring-sync");

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SNAPSHOTS))
          database.createObjectStore(SNAPSHOTS, { keyPath: ["eventSlug", "participantId"] });
        if (!database.objectStoreNames.contains(COMMANDS)) {
          const commands = database.createObjectStore(COMMANDS, { keyPath: "id" });
          commands.createIndex("eventParticipant", ["eventSlug", "participantId", "localSequence"]);
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Browser storage is unavailable")),
        { once: true },
      );
    });
    return this.database;
  }

  async saveSnapshot(snapshot: ScoreSnapshot): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SNAPSHOTS, "readwrite");
    transaction.objectStore(SNAPSHOTS).put(snapshot);
    await transactionDone(transaction);
    this.channel?.postMessage({
      type: "snapshot",
      eventSlug: snapshot.eventSlug,
      participantId: snapshot.participantId,
      revision: snapshot.revision,
    });
  }

  async getSnapshot(eventSlug: string, participantId: string): Promise<ScoreSnapshot | undefined> {
    const database = await this.open();
    const result = await requestResult(
      database.transaction(SNAPSHOTS).objectStore(SNAPSHOTS).get([eventSlug, participantId]),
    );
    return result as ScoreSnapshot | undefined;
  }

  async saveCommand(command: PendingScoreCommand): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(COMMANDS, "readwrite");
    transaction.objectStore(COMMANDS).put(command);
    await transactionDone(transaction);
    this.channel?.postMessage({ type: "command", id: command.id, state: command.state });
  }

  async listCommands(eventSlug: string, participantId: string): Promise<PendingScoreCommand[]> {
    const database = await this.open();
    const index = database.transaction(COMMANDS).objectStore(COMMANDS).index("eventParticipant");
    const range = IDBKeyRange.bound(
      [eventSlug, participantId, 0],
      [eventSlug, participantId, Number.MAX_SAFE_INTEGER],
    );
    return (await requestResult(index.getAll(range))) as PendingScoreCommand[];
  }

  async removeCommand(commandId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(COMMANDS, "readwrite");
    transaction.objectStore(COMMANDS).delete(commandId);
    await transactionDone(transaction);
  }

  subscribe(listener: () => void): () => void {
    const handler = () => listener();
    this.channel?.addEventListener("message", handler);
    return () => this.channel?.removeEventListener("message", handler);
  }

  close(): void {
    void this.database?.then((database) => database.close());
    this.channel?.close();
  }
}
