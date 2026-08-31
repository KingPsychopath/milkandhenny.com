import { createServerFn } from "@tanstack/react-start";
import { linkCurrentAttendeeGamePlayer } from "@/features/event-scoring/game-player-identity.server";
import {
  multiplayerBoundedText,
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerSequence,
  multiplayerText,
  optionalMultiplayerJoinAttempt,
} from "../shared/multiplayer-validation";
import {
  applyDrawCountryAction,
  createDrawCountryRoom,
  joinDrawCountryRoom,
  readDrawCountrySnapshot,
} from "./draw-country-room.server";
import { parseCountryDrawing } from "./drawing-constraints";
import type { CountryDrawing } from "./types";
import { countryById } from "./countries";
import { selectSoloCountry } from "./rotation.server";

const record = multiplayerRecord;
const text = multiplayerText;
const credential = multiplayerCredential;
const sequence = multiplayerSequence;

export const selectSoloCountryFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      recentCountryIds: Array.isArray(data.recentCountryIds)
        ? data.recentCountryIds.slice(-24).map((id) => text(id, 2))
        : [],
    };
  })
  .handler(({ data }) => selectSoloCountry(data.recentCountryIds));

export const readCountryOutlineFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => text(record(value).countryId, 2))
  .handler(({ data }) => {
    const country = countryById(data);
    if (!country) throw new Error("Country not found");
    return country;
  });

export const createDrawCountryRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      hostName: multiplayerBoundedText(data.hostName, 32, "Add your name").trim(),
      drawSeconds: Math.max(15, Math.min(90, sequence(data.drawSeconds ?? 30))),
      roundTotal: Math.max(1, Math.min(12, sequence(data.roundTotal ?? 5))),
      recentCountryIds: Array.isArray(data.recentCountryIds)
        ? data.recentCountryIds.slice(-36).map((id) => text(id, 2))
        : [],
    };
  })
  .handler(({ data }) => createDrawCountryRoom(data));

export const joinDrawCountryRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      joinToken: data.joinToken === undefined ? undefined : credential(data.joinToken),
      name: multiplayerBoundedText(data.name, 32, "Add your name").trim(),
      ...optionalMultiplayerJoinAttempt(data.joinId, data.playerToken),
    };
  })
  .handler(async ({ data }) => {
    const result = await joinDrawCountryRoom(data);
    if (result.ok)
      await linkCurrentAttendeeGamePlayer({
        gameKind: "draw-country",
        gameInstanceId: result.roomId,
        gamePlayerId: result.playerId,
      });
    return result;
  });

export const readDrawCountrySnapshotFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      playerId: text(data.playerId, 80),
      playerToken: credential(data.playerToken),
      lastSequence: sequence(data.lastSequence),
      lastDigest: typeof data.lastDigest === "string" ? data.lastDigest.slice(0, 24) : null,
    };
  })
  .handler(({ data }) => readDrawCountrySnapshot(data));

export const applyDrawCountryActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const rawAction = record(data.action);
    let action:
      | { type: "game.start"; removePlayerIds?: string[] }
      | { type: "room.admission.set"; locked: boolean }
      | { type: "readiness.set"; ready: boolean }
      | { type: "round.next" }
      | { type: "game.replay" }
      | { type: "game.lobby" }
      | { type: "drawing.submit"; roundId: string; drawing: CountryDrawing }
      | { type: "player.leave" }
      | { type: "player.rename"; name: string }
      | { type: "host.pass"; playerId: string };
    if (rawAction.type === "game.start")
      action = {
        type: rawAction.type,
        removePlayerIds: Array.isArray(rawAction.removePlayerIds)
          ? rawAction.removePlayerIds.slice(0, 16).map((playerId) => text(playerId, 80))
          : undefined,
      };
    else if (rawAction.type === "readiness.set" && typeof rawAction.ready === "boolean")
      action = { type: rawAction.type, ready: rawAction.ready };
    else if (rawAction.type === "room.admission.set" && typeof rawAction.locked === "boolean")
      action = { type: rawAction.type, locked: rawAction.locked };
    else if (
      rawAction.type === "round.next" ||
      rawAction.type === "game.replay" ||
      rawAction.type === "game.lobby"
    )
      action = { type: rawAction.type };
    else if (rawAction.type === "drawing.submit")
      action = {
        type: rawAction.type,
        roundId: text(rawAction.roundId, 80),
        drawing: parseCountryDrawing(rawAction.drawing),
      };
    else if (rawAction.type === "player.leave") action = { type: rawAction.type };
    else if (rawAction.type === "player.rename")
      action = {
        type: rawAction.type,
        name: multiplayerBoundedText(rawAction.name, 32, "Add your name").trim(),
      };
    else if (rawAction.type === "host.pass")
      action = { type: rawAction.type, playerId: text(rawAction.playerId, 80) };
    else throw new Error("Invalid action");
    return {
      roomId: multiplayerRoomId(data.roomId),
      playerId: text(data.playerId, 80),
      playerToken: credential(data.playerToken),
      action: { ...action, actionId: text(rawAction.actionId, 80) },
    };
  })
  .handler(({ data }) => applyDrawCountryAction(data));
