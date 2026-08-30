import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { HotAndColdRoomService } from "./hot-and-cold-room-service.server";
import type * as engine from "./hot-and-cold-room-engine.server";
import {
  markGamePoolPlayerLeft,
  markGamePoolPlayerSeen,
  markGamePoolPlayersRemoved,
} from "../pool/membership.server";

export const createHotAndColdRoom = (input: Parameters<typeof engine.createHotAndColdRoom>[0]) =>
  runMultiplayerEffect(HotAndColdRoomService.use((service) => service.createRoom(input)));
export const joinHotAndColdRoom = (input: Parameters<typeof engine.joinHotAndColdRoom>[0]) =>
  runMultiplayerEffect(HotAndColdRoomService.use((service) => service.joinRoom(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("hot-and-cold", input.roomId).catch(() => undefined);
      return result;
    },
  );
export const readHotAndColdSnapshot = (
  input: Parameters<typeof engine.readHotAndColdSnapshot>[0],
) =>
  runMultiplayerEffect(HotAndColdRoomService.use((service) => service.readSnapshot(input))).then(
    async (result) => {
      if (result.ok)
        await markGamePoolPlayerSeen({ roomId: input.roomId, playerId: input.playerId }).catch(
          () => undefined,
        );
      return result;
    },
  );
export const applyHotAndColdAction = (input: Parameters<typeof engine.applyHotAndColdAction>[0]) =>
  runMultiplayerEffect(HotAndColdRoomService.use((service) => service.applyAction(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("hot-and-cold", input.roomId).catch(() => undefined);
      if (result.accepted && input.action.type === "player.leave") {
        await markGamePoolPlayerLeft({ roomId: input.roomId, playerId: input.playerId }).catch(
          () => undefined,
        );
        await publishMultiplayerRoomTermination("hot-and-cold", input.roomId, {
          reason: "session_ended",
          playerId: input.playerId,
        }).catch(() => undefined);
      }
      if (result.accepted && input.action.type === "game.start") {
        const remainingPlayerIds = new Set(result.snapshot.players.map(({ id }) => id));
        const removedPlayerIds = (input.action.removePlayerIds ?? []).filter(
          (playerId) => !remainingPlayerIds.has(playerId),
        );
        await markGamePoolPlayersRemoved({
          roomId: input.roomId,
          playerIds: removedPlayerIds,
          actionId: input.action.actionId,
        }).catch(() => undefined);
        for (const playerId of removedPlayerIds)
          await publishMultiplayerRoomTermination("hot-and-cold", input.roomId, {
            reason: "removed",
            playerId,
          }).catch(() => undefined);
      }
      return result;
    },
  );
export const authorizeHotAndColdSocket = (
  input: Parameters<typeof engine.authorizeHotAndColdSocket>[0],
) => runMultiplayerEffect(HotAndColdRoomService.use((service) => service.authorizeSocket(input)));
