import type { RemoteRoomRole, RemoteTransportState } from "./types";
import { useReliableGameSocket } from "../shared/useReliableGameSocket";

export function useRemoteSocket(input: { roomId: string | null; role: RemoteRoomRole; token: string | null; onWake: () => void }) {
  const socket = useReliableGameSocket({
    path: "/api/things/remote-ws",
    hello: input.roomId && input.token ? { roomId: input.roomId, role: input.role, token: input.token } : null,
    onWake: input.onWake,
  });
  const state: RemoteTransportState = socket.state === "offline" ? "local" : socket.state;
  return { state, notify: socket.notify };
}
