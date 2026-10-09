import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  createPostgresRoom,
  readPostgresRoom,
  transitionPostgresRoom,
} from "../shared/room-postgres.server";
import {
  createMultiplayerCredential,
  createMultiplayerRoomId,
  hashMultiplayerCredential,
  multiplayerCredentialsMatch,
} from "../shared/room-primitives.server";
import { applyPairsRaceAction, pairsRaceSnapshot } from "./pairs-race-rules";
import type { PairsRace, PairsRaceAction } from "./pairs-race-rules";
import type { PairsSize } from "./pairs-rules";
import { createPairsGame } from "./pairs-rules";

const KIND = "pairs-race";
export interface PairsRaceIdentity {
  roomId: string;
  playerId: string;
  playerToken: string;
}

function authenticate(room: PairsRace, identity: PairsRaceIdentity) {
  return room.players.some(
    (player) =>
      player.id === identity.playerId &&
      multiplayerCredentialsMatch(identity.playerToken, player.tokenHash),
  );
}

export async function createPairsRace(input: { name: string; pairCount: PairsSize }) {
  input = { ...input, name: createPairsGame(0, input.pairCount, [input.name]).names[0] };
  const playerToken = createMultiplayerCredential();
  const playerId = randomUUID();
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = createMultiplayerRoomId();
    const state: PairsRace = {
      roomId,
      pairCount: input.pairCount,
      phase: "lobby",
      round: 0,
      expiresAt: now + 6 * 60 * 60 * 1000,
      players: [
        {
          id: playerId,
          name: input.name,
          tokenHash: hashMultiplayerCredential(playerToken),
          ready: false,
          wins: 0,
          game: null,
          unlockAt: 0,
        },
      ],
      winnerId: null,
      conceded: false,
      startsAt: 0,
    };
    if (
      await createPostgresRoom({
        kind: KIND,
        roomId,
        schemaVersion: 1,
        revision: 1,
        state,
        expiresAt: state.expiresAt,
      })
    )
      return {
        roomId,
        playerId,
        playerToken,
        expiresAt: state.expiresAt,
        snapshot: pairsRaceSnapshot(state, playerId, 1, now),
      };
  }
  throw new Error("Could not allocate a table");
}

/** Join credentials are generated and saved by the browser before sending, so a lost response can be retried. */
export async function joinPairsRace(input: {
  roomId: string;
  name: string;
  playerId: string;
  playerToken: string;
}) {
  input = { ...input, name: createPairsGame(0, 3, [input.name]).names[0] };
  const now = Date.now();
  const result = await transitionPostgresRoom<PairsRace, ReturnType<typeof pairsRaceSnapshot>>({
    kind: KIND,
    roomId: input.roomId,
    transition: (stored) => {
      const room = stored.state;
      const existing = room.players.find((player) => player.id === input.playerId);
      if (existing) {
        if (!multiplayerCredentialsMatch(input.playerToken, existing.tokenHash))
          throw new Error("That join is no longer valid");
        return {
          state: room,
          expiresAt: room.expiresAt,
          outcome: pairsRaceSnapshot(room, existing.id, stored.revision, now),
          persist: false,
        };
      }
      if (room.players.length >= 2) throw new Error("This table already has two players");
      if (room.phase !== "lobby") throw new Error("This match has already started");
      if (room.players.some((player) => player.name.toLowerCase() === input.name.toLowerCase()))
        throw new Error("That name is already at the table");
      room.players.push({
        id: input.playerId,
        name: input.name,
        tokenHash: hashMultiplayerCredential(input.playerToken),
        ready: false,
        wins: 0,
        game: null,
        unlockAt: 0,
      });
      return {
        state: room,
        expiresAt: room.expiresAt,
        outcome: pairsRaceSnapshot(room, input.playerId, stored.revision + 1, now),
      };
    },
  });
  if (!result) throw new Error("That table has expired");
  return { ...input, expiresAt: result.outcome.expiresAt, snapshot: result.outcome };
}

export async function readPairsRace(identity: PairsRaceIdentity) {
  const stored = await readPostgresRoom<PairsRace>(KIND, identity.roomId);
  if (!stored || !authenticate(stored.state, identity)) return null;
  return pairsRaceSnapshot(stored.state, identity.playerId, stored.revision, Date.now());
}

export async function commandPairsRace(
  input: PairsRaceIdentity & { actionId: string; action: PairsRaceAction },
  context = { now: Date.now(), seed: randomInt(0x100000000) },
) {
  const { now, seed } = context;
  const result = await transitionPostgresRoom<
    PairsRace,
    {
      accepted: boolean;
      error: string | null;
      snapshot: ReturnType<typeof pairsRaceSnapshot> | null;
    }
  >({
    kind: KIND,
    roomId: input.roomId,
    action: {
      id: input.actionId,
      fingerprintSha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    },
    transition: (stored) => {
      const room = stored.state;
      if (!authenticate(room, input))
        return {
          state: room,
          expiresAt: room.expiresAt,
          outcome: { accepted: false, error: "This player session has expired", snapshot: null },
          persist: false,
          recordAction: false,
        };
      const error = applyPairsRaceAction(room, input.playerId, input.action, { now, seed });
      return {
        state: room,
        expiresAt: room.expiresAt,
        outcome: {
          accepted: !error,
          error,
          snapshot: pairsRaceSnapshot(room, input.playerId, stored.revision + 1, now),
        },
      };
    },
  });
  return result?.outcome ?? { accepted: false, error: "That table has expired", snapshot: null };
}
