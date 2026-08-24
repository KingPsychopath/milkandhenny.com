import type { ReactNode } from "react";
import type { MultiplayerConnectionState } from "./multiplayer";
import "./RoomHeader.css";

export function RoomConnectionIndicator({
  state,
  label,
}: {
  state: MultiplayerConnectionState;
  label?: string;
}) {
  if (state === "connected") return null;

  const statusLabel = label ?? (state === "offline" ? "offline · reconnecting" : "reconnecting");
  return (
    <span
      className={`things-room-connection things-room-connection--${state}`}
      role="status"
      aria-label={statusLabel}
      title={statusLabel}
    >
      <span aria-hidden="true" className="things-room-connection-dot" />
    </span>
  );
}

export function ThingsRoomHeader({
  tone,
  back,
  roomId,
  connection,
  connectionLabel,
  detail,
  right,
}: {
  tone: "cream" | "night";
  back: ReactNode;
  roomId: string;
  connection?: MultiplayerConnectionState;
  connectionLabel?: string;
  detail?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className={`things-room-header things-room-header--${tone}`}>
      <div className="things-room-header-start">{back}</div>
      <div className="things-room-header-meta">
        <span className="things-room-header-code">{roomId}</span>
        {connection ? <RoomConnectionIndicator state={connection} label={connectionLabel} /> : null}
        {detail ? <span className="things-room-header-detail">· {detail}</span> : null}
      </div>
      <div className="things-room-header-actions">{right}</div>
    </header>
  );
}
