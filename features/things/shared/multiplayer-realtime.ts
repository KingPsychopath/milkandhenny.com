export const MULTIPLAYER_REALTIME_LIMITS = {
  heartbeatIntervalMs: 25_000,
  heartbeatTimeoutMs: 10_000,
  initialReconnectDelayMs: 500,
  maxMessageCharacters: 1_000,
  maxMessagesPerWindow: 120,
  maxConnectionsPerProcess: 5_000,
  maxConnectionsPerRoom: 100,
  maxReconnectDelayMs: 15_000,
  /** Wake reads remain authoritative, but never run closer together than this. */
  minimumReconciliationGapMs: 750,
  minimumWakeIntervalMs: 250,
  /** A socket that never sends an application ping is stale after this window. */
  preAuthHelloTimeoutMs: 10_000,
  rateWindowMs: 10_000,
  socketIdleTimeoutMs: 40_000,
  socketIdleSweepIntervalMs: 15_000,
} as const;

export const MULTIPLAYER_SOCKET_CLOSE = {
  normal: 1_000,
  policyViolation: 1_008,
  messageTooLarge: 1_009,
  serverOverloaded: 1_013,
  heartbeatTimeout: 4_001,
} as const;

export type MultiplayerClientControlMessage = { type: "changed" } | { type: "ping" };

export type MultiplayerServerMessage =
  | { type: "pong" }
  | { type: "ready" }
  | ({ type: "wake" } & Record<string, unknown>);

export function isMultiplayerClientControlMessage(
  value: unknown,
): value is MultiplayerClientControlMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = Reflect.get(value, "type");
  return type === "changed" || type === "ping";
}

export function isMultiplayerServerMessage(value: unknown): value is MultiplayerServerMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = Reflect.get(value, "type");
  return type === "pong" || type === "ready" || type === "wake";
}

export function isTerminalMultiplayerSocketClose(code: number) {
  return (
    code === MULTIPLAYER_SOCKET_CLOSE.policyViolation ||
    code === MULTIPLAYER_SOCKET_CLOSE.messageTooLarge
  );
}
