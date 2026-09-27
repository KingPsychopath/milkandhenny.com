import type { PoolClient, QueryResultRow } from "pg";

import type { OfficialGameResultEnvelope } from "@/features/game-results/types";
import { queryOne, transaction } from "@/lib/platform/postgres.server";

export interface PostgresRoom<State> {
  kind: string;
  roomId: string;
  schemaVersion: number;
  revision: number;
  state: State;
  expiresAt: number;
}

interface RoomRow extends QueryResultRow {
  kind: string;
  room_id: string;
  schema_version: number;
  revision: string;
  state: unknown;
  expires_at: Date;
}

interface ReceiptRow extends QueryResultRow {
  fingerprint_sha256: string;
  outcome: unknown;
  room_revision: string;
}

export class PostgresRoomActionConflictError extends Error {
  constructor() {
    super("Room action ID was reused with different input");
    this.name = "PostgresRoomActionConflictError";
  }
}

function fromRow<State>(row: RoomRow): PostgresRoom<State> {
  return {
    kind: row.kind,
    roomId: row.room_id,
    schemaVersion: row.schema_version,
    revision: Number(row.revision),
    state: row.state as State,
    expiresAt: row.expires_at.getTime(),
  };
}

/** Importers can insert the first aggregate; a live create never replaces an existing room. */
export async function createPostgresRoom<State>(room: PostgresRoom<State>): Promise<boolean> {
  const rows = await transaction((client) =>
    client.query(
      `insert into multiplayer_rooms (kind,room_id,schema_version,revision,state,expires_at)
       values ($1,$2,$3,$4,$5::jsonb,$6)
       on conflict do nothing returning room_id`,
      [
        room.kind,
        room.roomId,
        room.schemaVersion,
        room.revision,
        JSON.stringify(room.state),
        new Date(room.expiresAt),
      ],
    ),
  );
  return rows.rowCount === 1;
}

export async function readPostgresRoom<State>(
  kind: string,
  roomId: string,
): Promise<PostgresRoom<State> | null> {
  const row = await queryOne<RoomRow>(
    `select kind,room_id,schema_version,revision::text,state,expires_at
       from multiplayer_rooms
      where kind=$1 and room_id=$2 and expires_at>clock_timestamp()`,
    [kind, roomId],
  );
  return row ? fromRow<State>(row) : null;
}

/** A close races room actions under the same row lock and never erases result delivery. */
export async function deletePostgresRoom<State>(input: {
  kind: string;
  roomId: string;
  authorize: (state: State) => boolean;
}): Promise<boolean> {
  return transaction(async (client) => {
    const selected = await client.query<RoomRow>(
      `select kind,room_id,schema_version,revision::text,state,expires_at
         from multiplayer_rooms where kind=$1 and room_id=$2 for update`,
      [input.kind, input.roomId],
    );
    const row = selected.rows[0];
    if (!row || row.expires_at.getTime() <= Date.now()) return true;
    if (!input.authorize(row.state as State)) return false;
    await client.query("delete from multiplayer_rooms where kind=$1 and room_id=$2", [
      input.kind,
      input.roomId,
    ]);
    return true;
  });
}

export interface PostgresRoomTransition<State, Outcome> {
  state: State;
  expiresAt: number;
  outcome: Outcome;
  results?: readonly OfficialGameResultEnvelope[];
}

export interface PostgresRoomAction {
  id: string;
  fingerprintSha256: string;
}

async function insertResults(
  client: PoolClient,
  results: readonly OfficialGameResultEnvelope[],
): Promise<void> {
  for (const envelope of results) {
    const inserted = await client.query(
      `insert into multiplayer_game_result_outbox
         (channel_id,result_id,revision,payload_hash,envelope)
       values ($1,$2,$3,$4,$5::jsonb)
       on conflict do nothing returning result_id`,
      [
        envelope.channelId,
        envelope.resultId,
        envelope.revision,
        envelope.payloadHash,
        JSON.stringify(envelope),
      ],
    );
    if (inserted.rowCount === 1) continue;
    const existing = await client.query<{ payload_hash: string }>(
      `select payload_hash from multiplayer_game_result_outbox
        where channel_id=$1 and result_id=$2 and revision=$3`,
      [envelope.channelId, envelope.resultId, envelope.revision],
    );
    if (existing.rows[0]?.payload_hash !== envelope.payloadHash)
      throw new Error("Conflicting official game result revision");
  }
}

/**
 * The caller supplies a synchronous, side-effect-free transition. The row lock covers the
 * aggregate, duplicate receipt and result outbox. Advisory notification happens after return.
 */
export async function transitionPostgresRoom<State, Outcome>(input: {
  kind: string;
  roomId: string;
  action?: PostgresRoomAction;
  transition: (room: PostgresRoom<State>) => PostgresRoomTransition<State, Outcome>;
}): Promise<{ outcome: Outcome; revision: number; replayed: boolean } | null> {
  return transaction(async (client) => {
    const selected = await client.query<RoomRow>(
      `select kind,room_id,schema_version,revision::text,state,expires_at
         from multiplayer_rooms where kind=$1 and room_id=$2 for update`,
      [input.kind, input.roomId],
    );
    const row = selected.rows[0];
    if (!row || row.expires_at.getTime() <= Date.now()) return null;
    const room = fromRow<State>(row);
    if (input.action) {
      const receipt = await client.query<ReceiptRow>(
        `select fingerprint_sha256,outcome,room_revision::text
           from multiplayer_room_action_receipts
          where kind=$1 and room_id=$2 and action_id=$3`,
        [input.kind, input.roomId, input.action.id],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].fingerprint_sha256 !== input.action.fingerprintSha256)
          throw new PostgresRoomActionConflictError();
        return {
          outcome: receipt.rows[0].outcome as Outcome,
          revision: Number(receipt.rows[0].room_revision),
          replayed: true,
        };
      }
    }
    const next = input.transition(room);
    if (next.expiresAt <= Date.now()) throw new Error("Room transition cannot persist expiry");
    const revision = room.revision + 1;
    await client.query(
      `update multiplayer_rooms
          set state=$3::jsonb,revision=$4,expires_at=$5,updated_at=clock_timestamp()
        where kind=$1 and room_id=$2`,
      [input.kind, input.roomId, JSON.stringify(next.state), revision, new Date(next.expiresAt)],
    );
    if (input.action)
      await client.query(
        `insert into multiplayer_room_action_receipts
           (kind,room_id,action_id,fingerprint_sha256,outcome,room_revision)
         values ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          input.kind,
          input.roomId,
          input.action.id,
          input.action.fingerprintSha256,
          JSON.stringify(next.outcome),
          revision,
        ],
      );
    await insertResults(client, next.results ?? []);
    return { outcome: next.outcome, revision, replayed: false };
  });
}
