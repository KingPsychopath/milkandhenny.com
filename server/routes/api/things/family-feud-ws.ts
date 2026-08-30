import { familyFeudRealtimeChannel } from "@/features/things/family-feud/family-feud-keys";
import { authorizeFamilyFeudSocket } from "@/features/things/family-feud/family-feud-room.server";
import type { FamilyFeudViewerRole } from "@/features/things/family-feud/types";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

interface FamilyFeudRealtimeSession {
  roomId: string;
  role: FamilyFeudViewerRole;
}

export default createMultiplayerWakeHandler<FamilyFeudRealtimeSession>({
  channel: familyFeudRealtimeChannel,
  game: "family-feud",
  async authorize(payload) {
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const credential = typeof payload.credential === "string" ? payload.credential : "";
    const role = payload.role;
    if (
      !roomId ||
      !credential ||
      (role !== "presenter" && role !== "controller" && role !== "buzzer")
    )
      return null;
    return (await authorizeFamilyFeudSocket({ roomId, credential, role }))
      ? { roomId, role }
      : null;
  },
});
