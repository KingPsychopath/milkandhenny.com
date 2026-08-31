import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { activeRoomMatchesPath, readActiveRooms, type ActiveRoom } from "./active-room-recovery";
import { useGameNavigationSafety } from "./useSafeGameNavigation";

const DISMISSED_ROOMS_KEY = "things:active-room-notice:v1:dismissed";
const NOTICE_REFRESH_MS = 60_000;
const MAX_VISIBLE_ROOMS = 2;

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

export function ActiveRoomNotice() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [rooms, setRooms] = useState<ActiveRoom[]>([]);
  const [dismissedRooms, setDismissedRooms] = useState<string[]>(readDismissedRooms);
  const [expanded, setExpanded] = useState(false);
  const safeGameScreen = useGameNavigationSafety();

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
    (room) => !dismissedRooms.includes(room.path) && !activeRoomMatchesPath(room, pathname),
  );
  const visible = expanded ? available : available.slice(0, MAX_VISIBLE_ROOMS);
  if (available.length === 0) return null;
  if (pathname.startsWith("/things/") && !safeGameScreen) return null;
  if (/^\/things\/[^/]+\/[A-Z2-9]{7}(?:\/|$)/.test(pathname)) return null;

  const dismiss = () => {
    const next = [...new Set([...dismissedRooms, ...available.map(({ path }) => path)])];
    setDismissedRooms(next);
    writeDismissedRooms(next);
  };

  return (
    <aside
      aria-labelledby="active-room-notice-title"
      className="active-room-notice themed-floating-notice fixed inset-x-3 bottom-[var(--active-room-notice-bottom)] z-50 mx-auto max-w-xl border backdrop-blur-xl sm:inset-x-6"
    >
      <div className="active-room-notice__body">
        <div className="active-room-notice__beacon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" className="size-6">
            <path d="M5 5.5h9.5v13H5z" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M14.5 12H21m-2.5-2.5L21 12l-2.5 2.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="8.25" cy="12" r=".75" fill="currentColor" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="active-room-notice__eyebrow font-mono text-micro uppercase tracking-[0.18em]">
                <span className="active-room-notice__pulse" aria-hidden="true" />
                room still open
              </p>
              <p id="active-room-notice-title" className="mt-1.5 font-serif text-xl leading-tight">
                {available.length === 1 ? "Your game is waiting." : "Your games are waiting."}
              </p>
              <p className="themed-floating-notice-muted mt-1 font-mono text-[0.6875rem] leading-relaxed">
                Pick up where you left off.
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss active room notice"
              className="active-room-notice__dismiss themed-floating-notice-muted shrink-0 font-mono text-xs hover:text-[var(--floating-notice-foreground)]"
            >
              <span className="hidden sm:inline">not now</span>
              <span aria-hidden="true" className="text-lg leading-none">
                ×
              </span>
            </button>
          </div>

          <ul className="active-room-notice__rooms themed-floating-notice-border mt-4 border-t">
            {visible.map((room) => (
              <li
                key={room.path}
                className="themed-floating-notice-border border-b last:border-b-0"
              >
                <a href={room.path} className="active-room-notice__room">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs font-semibold lowercase">
                      {room.label}
                    </span>
                    <span className="themed-floating-notice-muted mt-0.5 block font-mono text-micro uppercase tracking-[0.14em]">
                      room {room.roomId}
                    </span>
                  </span>
                  <span className="active-room-notice__return font-mono text-xs">
                    <span>rejoin</span>
                    <span className="active-room-notice__arrow" aria-hidden="true">
                      →
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>

          {available.length > MAX_VISIBLE_ROOMS ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
              className="themed-floating-notice-muted mt-2 inline-flex min-h-11 items-center px-1 font-mono text-xs hover:text-[var(--floating-notice-foreground)]"
            >
              {expanded ? "show fewer rooms" : `show ${available.length - MAX_VISIBLE_ROOMS} more`}
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
