export const MULTIPLAYER_GAMES = ["remote", "spelling-party"] as const;

export type MultiplayerGame = (typeof MULTIPLAYER_GAMES)[number];

export interface MultiplayerLatencySnapshot {
  samples: number;
  averageMs: number | null;
  maxMs: number | null;
}

export interface MultiplayerGameTelemetry {
  activeSockets: number;
  operationFailures: number;
  operations: number;
  rateLimited: number;
  reconciliation: MultiplayerLatencySnapshot;
  socketTerminations: Record<string, number>;
}

export interface MultiplayerTelemetrySnapshot {
  backplane: {
    failures: number;
    mode: "local" | "redis";
    published: number;
    received: number;
  };
  capturedAt: string;
  runtimeStartedAt: string;
  replica: string;
  games: Record<MultiplayerGame, MultiplayerGameTelemetry>;
  partyRoomLock: {
    acquisitions: number;
    contention: number;
    failures: number;
    wait: MultiplayerLatencySnapshot;
  };
}
