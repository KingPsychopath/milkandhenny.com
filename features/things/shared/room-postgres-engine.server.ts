import { publishOfficialResultsAfterCommit } from "@/features/game-results/outbox.server";
import type { OfficialGameResultEnvelope } from "@/features/game-results/types";
import {
  createPostgresRoom,
  readPostgresRoom,
  transitionPostgresRoom,
  type PostgresRoomAction,
} from "./room-postgres.server";

export function postgresGameRoomSelected(envName: string) {
  if (process.env[envName] !== "postgres") return false;
  if (process.env.OFFICIAL_GAME_RESULT_OUTBOX_STORE !== "postgres")
    throw new Error("Postgres rooms require the Postgres official-result outbox");
  return true;
}

export async function loadPostgresGameRoom<State>(kind: string, roomId: string) {
  return (await readPostgresRoom<State>(kind, roomId))?.state ?? null;
}

export async function createPostgresGameRoom<
  State extends { roomId: string; revision: number; expiresAt: number },
>(kind: string, room: State) {
  if (room.expiresAt <= Date.now()) throw new Error("Cannot create an expired room");
  if (
    !(await createPostgresRoom({
      kind,
      roomId: room.roomId,
      schemaVersion: 1,
      revision: room.revision,
      state: room,
      expiresAt: room.expiresAt,
    }))
  )
    throw new Error("Could not allocate room");
}

/** One synchronous reducer, one row lock and one committed result/outbox state. */
export async function withPostgresGameRoom<State extends { expiresAt: number }, Outcome>(input: {
  kind: string;
  roomId: string;
  action?: PostgresRoomAction;
  use: (room: State) => Outcome | Promise<Outcome>;
  applyExpiry: (room: State) => void;
  results: (before: State, after: State) => readonly OfficialGameResultEnvelope[];
  recordAction?: (outcome: Outcome) => boolean;
  validate?: (room: State) => boolean;
}): Promise<Outcome | null> {
  let queued: readonly OfficialGameResultEnvelope[] = [];
  const committed = await transitionPostgresRoom<State, Outcome>({
    kind: input.kind,
    roomId: input.roomId,
    action: input.action,
    transition: (stored) => {
      const room = stored.state;
      if (input.validate && !input.validate(room)) throw new Error("Unsupported room version");
      const before = structuredClone(room);
      const original = JSON.stringify(room);
      const outcome = input.use(room);
      if (outcome instanceof Promise)
        throw new Error("Postgres room transitions must not perform async effects");
      if (JSON.stringify(room) !== original) input.applyExpiry(room);
      queued = input.results(before, room);
      return {
        state: room,
        expiresAt: room.expiresAt,
        outcome,
        results: queued,
        persist: JSON.stringify(room) !== original,
        recordAction: input.recordAction?.(outcome) ?? true,
      };
    },
  });
  if (committed && !committed.replayed)
    publishOfficialResultsAfterCommit(
      queued.map((envelope) => ({ key: `postgres:${envelope.payloadHash}`, envelope })),
    );
  return committed?.outcome ?? null;
}
