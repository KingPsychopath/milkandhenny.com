import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
import { applyPairsRaceAction } from "./pairs-race-rules";
import type { PairsRace } from "./pairs-race-rules";
import { commandPairsRace, createPairsRace, joinPairsRace } from "./pairs-race.server";
import type { PairsRaceIdentity } from "./pairs-race.server";

const holder = globalThis as typeof globalThis & { __pairsDevCaptureKey?: string };
const key = (holder.__pairsDevCaptureKey ??= randomBytes(32).toString("hex"));
export const PAIRS_RACE_SCENARIOS = ["lobby", "live race", "round reveal", "final result"] as const;
export type PairsRaceScenario = (typeof PAIRS_RACE_SCENARIOS)[number];
function guard() {
  if (!import.meta.env.DEV) throw new Error("Development only");
}

export async function startPairsRaceScenario(scenario: PairsRaceScenario) {
  guard();
  const host = await createPairsRace({ name: "Alex", pairCount: 3 });
  const guest = await joinPairsRace({
    roomId: host.roomId,
    name: "Jo",
    playerId: randomUUID(),
    playerToken: createMultiplayerCredential(),
  });
  await transitionPostgresRoom<PairsRace, null>({
    kind: "pairs-race",
    roomId: host.roomId,
    transition: (stored) => {
      const room = stored.state;
      let now = Date.now() - 100_000;
      const act = (playerId: string, action: Parameters<typeof applyPairsRaceAction>[2]) => {
        const error = applyPairsRaceAction(room, playerId, action, { now, seed: 404 + room.round });
        if (error) throw new Error(error);
        now += 4000;
      };
      if (scenario !== "lobby") {
        const rounds = scenario === "final result" ? 2 : 1;
        for (let round = 0; round < rounds; round++) {
          for (const player of room.players) act(player.id, { type: "ready", ready: true });
          act(host.playerId, { type: "begin" });
          if (scenario === "live race") break;
          for (let pair = 0; pair < 3; pair++) {
            const game = room.players[0].game!;
            const a = game.cards.findIndex((_, index) => !game.matched.includes(index));
            const b = game.cards.findIndex(
              (card, index) => index !== a && card.rank === game.cards[a].rank,
            );
            act(host.playerId, { type: "flip", index: a, round: room.round });
            act(host.playerId, { type: "flip", index: b, round: room.round });
          }
        }
      }
      return { state: room, expiresAt: room.expiresAt, outcome: null };
    },
  });
  return [host, guest].map(({ roomId, playerId, playerToken, expiresAt }) => ({
    roomId,
    playerId,
    playerToken,
    expiresAt,
  }));
}

async function authorizedRoom(identity: PairsRaceIdentity) {
  guard();
  const stored = await readPostgresRoom<PairsRace>("pairs-race", identity.roomId);
  if (
    !stored?.state.players.some(
      (player) =>
        player.id === identity.playerId &&
        multiplayerCredentialsMatch(identity.playerToken, player.tokenHash),
    )
  )
    throw new Error("Table unavailable");
  return stored.state;
}

export async function stepPairsRaceBot(identity: PairsRaceIdentity) {
  const room = await authorizedRoom(identity);
  const player = room.players.find((candidate) => candidate.id === identity.playerId)!;
  if (room.phase !== "playing" || !player.game) return;
  const now = Math.max(Date.now(), room.startsAt + 1, player.unlockAt + 1);
  const first =
    player.game.phase === "playing" && player.game.selected.length
      ? player.game.selected[0]
      : player.game.cards.findIndex((_, index) => !player.game!.matched.includes(index));
  const second = player.game.cards.findIndex(
    (card, index) => index !== first && card.rank === player.game!.cards[first].rank,
  );
  const indices =
    player.game.phase === "playing" && player.game.selected.length ? [second] : [first, second];
  for (const index of indices)
    await commandPairsRace(
      { ...identity, actionId: randomUUID(), action: { type: "flip", index, round: room.round } },
      { now, seed: 404 },
    );
}

export async function capturePairsRace(identity: PairsRaceIdentity) {
  const room = await authorizedRoom(identity);
  const payload = JSON.stringify({ version: 1, capturedAt: Date.now(), room });
  return JSON.stringify({
    payload,
    signature: createHmac("sha256", key).update(payload).digest("hex"),
  });
}

export async function restorePairsRaceCapture(capture: string) {
  guard();
  const parsed: unknown = JSON.parse(capture);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("payload" in parsed) ||
    typeof parsed.payload !== "string" ||
    !("signature" in parsed) ||
    typeof parsed.signature !== "string"
  )
    throw new Error("Invalid capture");
  const signature = Buffer.from(parsed.signature, "hex");
  const expected = createHmac("sha256", key).update(parsed.payload).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
    throw new Error("This capture is invalid or belongs to an earlier development server session");
  // Only this server can sign a capture, so the validated payload has our own state schema.
  const { room, capturedAt } = JSON.parse(parsed.payload) as {
    version: 1;
    room: PairsRace;
    capturedAt: number;
  };
  const now = Date.now();
  const elapsed = now - capturedAt;
  room.roomId = createMultiplayerRoomId();
  room.expiresAt = now + 6 * 60 * 60 * 1000;
  room.startsAt += elapsed;
  const seats = room.players.map((player) => {
    const token = createMultiplayerCredential();
    const oldId = player.id;
    player.id = randomUUID();
    player.tokenHash = hashMultiplayerCredential(token);
    if (room.winnerId === oldId) room.winnerId = player.id;
    if (player.unlockAt) player.unlockAt += elapsed;
    return {
      roomId: room.roomId,
      playerId: player.id,
      playerToken: token,
      expiresAt: room.expiresAt,
    };
  });
  if (
    !(await createPostgresRoom({
      kind: "pairs-race",
      roomId: room.roomId,
      state: room,
      schemaVersion: 1,
      revision: 1,
      expiresAt: room.expiresAt,
    }))
  )
    throw new Error("Could not restore capture");
  return seats;
}
