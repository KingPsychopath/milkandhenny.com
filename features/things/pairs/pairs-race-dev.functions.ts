import { createServerFn } from "@tanstack/react-start";
import {
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerText,
} from "../shared/multiplayer-validation";
import {
  capturePairsRace,
  restorePairsRaceCapture,
  startPairsRaceScenario,
  stepPairsRaceBot,
} from "./pairs-race-dev.server";
function identity(value: unknown) {
  const data = multiplayerRecord(value);
  return {
    roomId: multiplayerRoomId(data.roomId),
    playerId: multiplayerText(data.playerId, 80),
    playerToken: multiplayerCredential(data.playerToken),
  };
}
export const startPairsRaceScenarioFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    if (
      value !== "lobby" &&
      value !== "live race" &&
      value !== "round reveal" &&
      value !== "final result"
    )
      throw new Error("Invalid scenario");
    return value;
  })
  .handler(({ data }) => startPairsRaceScenario(data));
export const stepPairsRaceBotFn = createServerFn({ method: "POST" })
  .validator(identity)
  .handler(({ data }) => stepPairsRaceBot(data));
export const capturePairsRaceFn = createServerFn({ method: "POST" })
  .validator(identity)
  .handler(({ data }) => capturePairsRace(data));
export const restorePairsRaceCaptureFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => multiplayerText(value, 100_000))
  .handler(({ data }) => restorePairsRaceCapture(data));
