/** Shared source of truth for game channel versions and telemetry coverage. */
export const MULTIPLAYER_GAME_REGISTRY = {
  remote: { channelVersion: "v3" },
  "spelling-party": { channelVersion: "v2" },
  "draw-country": { channelVersion: "v1" },
  liars: { channelVersion: "v1" },
  "same-brain": { channelVersion: "v1" },
  twin: { channelVersion: "v1" },
  centre: { channelVersion: "v1" },
  "game-pool": { channelVersion: "v1" },
} as const;

export const MULTIPLAYER_GAMES = Object.freeze(
  Object.keys(MULTIPLAYER_GAME_REGISTRY),
) as ReadonlyArray<keyof typeof MULTIPLAYER_GAME_REGISTRY>;

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
