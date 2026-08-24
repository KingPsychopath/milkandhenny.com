import { createServerFn } from "@tanstack/react-start";
import {
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerText,
} from "../shared/multiplayer-validation";
import {
  assignGamePoolRoom,
  getGamePoolPublicView,
  releaseGamePoolAssignment,
} from "./pool.server";
import { getDefaultGamePoolPublicLink } from "./store.server";
import { isGamePoolGame } from "./presets";

function token(value: unknown) {
  const parsed = multiplayerText(value, 80, "Invalid game-night link");
  if (!/^play_[A-Za-z0-9_-]{26,}$/.test(parsed)) throw new Error("Invalid game-night link");
  return parsed;
}

function clientId(value: unknown) {
  const parsed = multiplayerText(value, 120, "Invalid device");
  if (parsed.length < 12 || !/^[A-Za-z0-9_-]+$/.test(parsed)) throw new Error("Invalid device");
  return parsed;
}

export const getGamePoolPublicViewFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    return { token: token(data.token) };
  })
  .handler(({ data }) => getGamePoolPublicView(data.token));

/** Resolve the admin-selected, currently open public entrance for a game. */
export const getDefaultGamePoolLaunchFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    if (!isGamePoolGame(data.game)) throw new Error("Unsupported game");
    return { game: data.game };
  })
  .handler(({ data }) => getDefaultGamePoolPublicLink(data.game));

export const assignGamePoolRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    const rawChoice = data.choice;
    const choice: "auto" | "new" | { roomId: string } =
      rawChoice === "auto" || rawChoice === "new"
        ? rawChoice
        : (() => {
            const record = multiplayerRecord(rawChoice);
            return { roomId: multiplayerRoomId(record.roomId) };
          })();
    return {
      token: token(data.token),
      clientId: clientId(data.clientId),
      name: multiplayerText(data.name, 32, "Invalid name"),
      choice,
      moveExisting: data.moveExisting === true,
    };
  })
  .handler(({ data }) => assignGamePoolRoom(data));

export const releaseGamePoolAssignmentFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    return { token: token(data.token), clientId: clientId(data.clientId) };
  })
  .handler(({ data }) => releaseGamePoolAssignment(data));
