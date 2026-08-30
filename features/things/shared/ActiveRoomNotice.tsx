import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { readExpiringLocalValue } from "./game-storage.client";

const ROOM_GAMES = {
  "same-brain": "same brain",
  liars: "liars",
  "draw-country": "draw the country",
  centre: "centre",
  twin: "twin",
  "spelling-party": "spelling party",
  remote: "remote game",
} as const;
const DISMISSED_ROOMS_KEY = "things:active-room-notice:v1:dismissed";
const NOTICE_REFRESH_MS = 60_000;
const MAX_VISIBLE_ROOMS = 2;

type ActiveRoom = {
  game: keyof typeof ROOM_GAMES;
  label: string;
  path: string;
  roomId: string;
};

function readDismissedRooms() {
  if (typeof window === "undefined") return [];
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(DISMISSED_ROOMS_KEY) ?? "null");
    return Array.isArray(stored) && stored.every((path): path is string => typeof path === "string")
      ? stored
      : [];
  } catch {
    return [];
  }
}

function writeDismissedRooms(paths: string[]) {
  try {
    sessionStorage.setItem(DISMISSED_ROOMS_KEY, JSON.stringify(paths));
  } catch {
    // Storage is optional. The notice can still be dismissed for this render.
  }
}

function readActiveRooms() {
  const rooms: ActiveRoom[] = [];
  const seenPaths = new Set<string>();
  const addRoom = (room: ActiveRoom) => {
    if (seenPaths.has(room.path)) return;
    seenPaths.add(room.path);
    rooms.push(room);
  };
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const match = key?.match(
        /^things:([^:]+):v\d+:room:([^:]+):(?:player-session|host-session|presenter-recovery)$/,
      );
      const game = match?.[1] as keyof typeof ROOM_GAMES | undefined;
      const roomId = match?.[2];
      if (!game || !roomId || !(game in ROOM_GAMES) || !key) continue;
      if (!readExpiringLocalValue(key)) continue;
      addRoom({
        game,
        label: ROOM_GAMES[game],
        path: `/things/${game}/${encodeURIComponent(roomId)}`,
        roomId,
      });
    }

    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      const match = key?.match(/^things:remote:v\d+:room:([^:]+):player-session$/);
      if (!match || !key) continue;
      const stored = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
        expiresAt?: unknown;
        setup?: { game?: unknown };
      } | null;
      if (typeof stored?.expiresAt !== "number" || stored.expiresAt <= Date.now()) {
        sessionStorage.removeItem(key);
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
    // Storage is optional. A private browser or blocked storage simply has no notice.
  }
  return rooms.sort((left, right) => left.path.localeCompare(right.path));
}

export function ActiveRoomNotice() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [rooms, setRooms] = useState<ActiveRoom[]>([]);
  const [dismissedRooms, setDismissedRooms] = useState<string[]>(readDismissedRooms);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const refresh = () => setRooms(readActiveRooms());
    refresh();
    setDismissedRooms(readDismissedRooms());
    setExpanded(false);
    window.addEventListener("storage", refresh);
    const interval = window.setInterval(refresh, NOTICE_REFRESH_MS);
    return () => {
      window.removeEventListener("storage", refresh);
      window.clearInterval(interval);
    };
  }, [pathname]);

  const available = rooms.filter(
    (room) =>
      !dismissedRooms.includes(room.path) &&
      pathname !== room.path &&
      !pathname.startsWith(`${room.path}/`),
  );
  const visible = expanded ? available : available.slice(0, MAX_VISIBLE_ROOMS);
  if (available.length === 0) return null;

  const dismiss = () => {
    const next = [...new Set([...dismissedRooms, ...available.map(({ path }) => path)])];
    setDismissedRooms(next);
    writeDismissedRooms(next);
  };

  return (
    <aside
      role="status"
      aria-label="Active game rooms"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md border theme-border bg-background/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.18em] theme-muted">
            still in a room
          </p>
          <p className="mt-2 font-serif text-lg text-foreground">
            Tap here to rejoin {available.length === 1 ? "your game" : "a game"}.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss active room notice"
          className="flex size-11 shrink-0 items-center justify-center font-mono text-lg theme-muted hover:text-foreground"
        >
          ×
        </button>
      </div>
      <ul className="mt-3 border-t theme-border">
        {visible.map((room) => (
          <li key={`${room.game}:${room.roomId}`} className="border-b theme-border last:border-b-0">
            <a
              href={room.path}
              className="flex min-h-12 items-center justify-between gap-4 font-mono text-xs theme-muted hover:text-foreground"
            >
              <span>
                {room.label} · {room.roomId}
              </span>
              <span aria-hidden="true">→</span>
            </a>
          </li>
        ))}
      </ul>
      {available.length > MAX_VISIBLE_ROOMS ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="mt-3 inline-flex min-h-11 items-center px-2 font-mono text-xs theme-muted hover:text-foreground"
        >
          {expanded ? "show fewer rooms" : `show ${available.length - MAX_VISIBLE_ROOMS} more`}
        </button>
      ) : null}
    </aside>
  );
}
