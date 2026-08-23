import { createServerFn } from "@tanstack/react-start";

import { multiplayerRecord, multiplayerText } from "../shared/multiplayer-validation";
import { controlGamePoolAsOperator, getGamePoolOperatorView } from "./operator.server";

function token(value: unknown) {
  const parsed = multiplayerText(value, 100);
  if (!/^operate_[A-Za-z0-9_-]{30,}$/.test(parsed)) throw new Error("Invalid organizer link");
  return parsed;
}

export const getGamePoolOperatorViewFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => token(multiplayerRecord(value).token))
  .handler(({ data }) => getGamePoolOperatorView(data));

export const controlGamePoolAsOperatorFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    if (
      data.action !== "pause" &&
      data.action !== "resume" &&
      data.action !== "close" &&
      data.action !== "close-room"
    )
      throw new Error("Invalid organizer action");
    const action = data.action as "pause" | "resume" | "close" | "close-room";
    return {
      token: token(data.token),
      action,
      roomId: data.roomId === undefined ? undefined : multiplayerText(data.roomId, 20),
    };
  })
  .handler(({ data }) => controlGamePoolAsOperator(data.token, data.action, data.roomId));
