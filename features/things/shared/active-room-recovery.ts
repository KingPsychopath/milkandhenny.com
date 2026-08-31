import { readExpiringLocalValue, removeStorageKeys } from "./game-storage.client";

const ROOM_GAMES = {
  "same-brain": "same brain",
  liars: "liars",
  "draw-country": "draw the country",
  centre: "centre",
  twin: "twin",
  "spelling-party": "spelling party",
  "hot-and-cold": "hot & cold",
  "family-feud": "family feud",
  remote: "remote game",
} as const;

export type ActiveRoom = {
  game: keyof typeof ROOM_GAMES;
  label: string;
  path: string;
  roomId: string;
};

type ActiveRoomSession =
  | "player-session"
  | "host-session"
  | "presenter-recovery"
  | "controller-session";

export function activeRoomPath(
  game: keyof typeof ROOM_GAMES,
  roomId: string,
  session: ActiveRoomSession,
) {
  const roomPath = `/things/${game}/${encodeURIComponent(roomId)}`;
  if (session === "presenter-recovery") return `${roomPath}/present`;
  if (game === "family-feud" && session === "controller-session") return `${roomPath}/control`;
  return roomPath;
}

function activeRoomLabel(game: keyof typeof ROOM_GAMES, session: ActiveRoomSession) {
  const label = ROOM_GAMES[game];
  if (session === "presenter-recovery") return `${label} TV`;
  if (session === "controller-session") return `${label} MC`;
  return label;
}

export function activeRoomMatchesPath(room: ActiveRoom, pathname: string) {
  const roomPath =
    room.game === "remote"
      ? `/things/play/${encodeURIComponent(room.roomId)}`
      : `/things/${room.game}/${encodeURIComponent(room.roomId)}`;
  return pathname === roomPath || pathname.startsWith(`${roomPath}/`);
}

function storageKeys(storage: Storage) {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => typeof key === "string",
  );
}

export function readActiveRooms() {
  const rooms: ActiveRoom[] = [];
  const seenPaths = new Set<string>();
  const addRoom = (room: ActiveRoom) => {
    if (seenPaths.has(room.path)) return;
    seenPaths.add(room.path);
    rooms.push(room);
  };

  try {
    // Snapshot keys first: reading an expired record removes it, which would otherwise shift the
    // next live entry backwards and make the loop skip it for a full refresh interval.
    for (const key of storageKeys(localStorage)) {
      const match = key.match(
        /^things:([^:]+):v\d+:room:([^:]+):(player-session|host-session|presenter-recovery|controller-session)$/,
      );
      const game = match?.[1] as keyof typeof ROOM_GAMES | undefined;
      const roomId = match?.[2];
      const session = match?.[3] as ActiveRoomSession | undefined;
      if (!game || !roomId || !session || !(game in ROOM_GAMES)) continue;
      if (!readExpiringLocalValue(key)) continue;
      addRoom({
        game,
        label: activeRoomLabel(game, session),
        path: activeRoomPath(game, roomId, session),
        roomId,
      });
    }
  } catch {
    // A blocked local store must not hide session-scoped remote rooms.
  }

  try {
    for (const key of storageKeys(sessionStorage)) {
      const match = key.match(/^things:remote:v\d+:room:([^:]+):player-session$/);
      if (!match) continue;
      let stored: {
        expiresAt?: unknown;
        setup?: { game?: unknown };
      } | null;
      try {
        stored = JSON.parse(sessionStorage.getItem(key) ?? "null") as typeof stored;
      } catch {
        continue;
      }
      if (typeof stored?.expiresAt !== "number" || stored.expiresAt <= Date.now()) {
        removeStorageKeys(sessionStorage, [key]);
        continue;
      }
      const label = stored.setup?.game === "heads-up" ? "heads up" : "spelling bee";
      const roomId = match[1];
      if (roomId)
        addRoom({
          game: "remote",
          label,
          path: `/things/play/${encodeURIComponent(roomId)}`,
          roomId,
        });
    }
  } catch {
    // Storage is recovery only. A private browser may reject every operation.
  }

  return rooms.sort((left, right) => left.path.localeCompare(right.path));
}
