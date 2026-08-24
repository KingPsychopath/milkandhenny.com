import { authorizePresentationSocket } from "@/features/things/pitches/presentation.server";
import {
  PRESENTATION_ROOM_PATTERN,
  PRESENTATION_TOKEN_PATTERN,
} from "@/features/things/pitches/presentation-validation";
import { gameRealtimeChannel } from "@/features/things/shared/multiplayer-keys";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

interface PresentationRealtimeSession {
  roomId: string;
  role: "host" | "controller";
  playerId?: string;
}

export default createMultiplayerWakeHandler<PresentationRealtimeSession>({
  channel: (roomId) => gameRealtimeChannel("pitch-presentation", 1, roomId),
  game: "pitch-presentation",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const role = payload.role;
    const hostToken = typeof payload.hostToken === "string" ? payload.hostToken : undefined;
    const controllerId =
      typeof payload.controllerId === "string" ? payload.controllerId : undefined;
    const controllerToken =
      typeof payload.controllerToken === "string" ? payload.controllerToken : undefined;
    if (!PRESENTATION_ROOM_PATTERN.test(roomId)) return null;
    if (role === "host") {
      if (!hostToken || !PRESENTATION_TOKEN_PATTERN.test(hostToken)) return null;
      return authorizePresentationSocket({ roomId, role, hostToken });
    }
    if (role !== "controller") return null;
    if (
      !controllerId ||
      !controllerToken ||
      !PRESENTATION_TOKEN_PATTERN.test(controllerId) ||
      !PRESENTATION_TOKEN_PATTERN.test(controllerToken)
    )
      return null;
    return authorizePresentationSocket({ roomId, role, controllerId, controllerToken });
  },
});
