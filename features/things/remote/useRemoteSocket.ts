import type { PairedGameRoomRole, RemoteTransportState } from "./types";
import { useMultiplayerWakeSocket } from "../shared/useMultiplayerWakeSocket";

export function useRemoteSocket(input: { roomId: string | null; role: PairedGameRoomRole; token: string | null; onWake: () => void }) {
  const socket = useMultiplayerWakeSocket({
    path: "/api/things/remote-ws",
    hello: input.roomId && input.token ? { roomId: input.roomId, role: input.role, token: input.token } : null,
    onWake: input.onWake,
  });
  const state: RemoteTransportState = socket.state === "offline" ? "local" : socket.state;
  return { state, notify: socket.notify };
}
