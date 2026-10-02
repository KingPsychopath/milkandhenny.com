import { createServerFn } from "@tanstack/react-start";
import {
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerText,
} from "../shared/multiplayer-validation";
import {
  commandPairsRace,
  createPairsRace,
  joinPairsRace,
  readPairsRace,
} from "./pairs-race.server";
import type { PairsRaceAction } from "./pairs-race-rules";
import type { PairsSize } from "./pairs-rules";

function name(value: unknown) {
  const text = multiplayerText(value, 24, "Add your name").trim();
  if (!text) throw new Error("Add your name");
  return text;
}
function identity(value: Record<string, unknown>) {
  return {
    roomId: multiplayerRoomId(value.roomId),
    playerId: multiplayerText(value.playerId, 80),
    playerToken: multiplayerCredential(value.playerToken),
  };
}
export const createPairsRaceFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    const rawSize = data.pairCount;
    if (rawSize !== 3 && rawSize !== 6 && rawSize !== 10) throw new Error("Invalid table size");
    const pairCount: PairsSize = rawSize;
    return { name: name(data.name), pairCount };
  })
  .handler(({ data }) => createPairsRace(data));

export const joinPairsRaceFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    return { ...identity(data), name: name(data.name) };
  })
  .handler(({ data }) => joinPairsRace(data));

export const readPairsRaceFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => identity(multiplayerRecord(value)))
  .handler(({ data }) => readPairsRace(data));

export const commandPairsRaceFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    const raw = multiplayerRecord(data.action);
    let action: PairsRaceAction;
    if (raw.type === "ready" && typeof raw.ready === "boolean")
      action = { type: "ready", ready: raw.ready };
    else if (raw.type === "begin" || raw.type === "concede") action = { type: raw.type };
    else if (
      raw.type === "flip" &&
      typeof raw.index === "number" &&
      Number.isInteger(raw.index) &&
      raw.index >= 0 &&
      raw.index < 20 &&
      typeof raw.round === "number" &&
      Number.isInteger(raw.round) &&
      raw.round >= 1 &&
      raw.round <= 3
    )
      action = { type: "flip", index: raw.index, round: raw.round };
    else throw new Error("Invalid race action");
    return { ...identity(data), actionId: multiplayerText(data.actionId, 80), action };
  })
  .handler(({ data }) => commandPairsRace(data));
