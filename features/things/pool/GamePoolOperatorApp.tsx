import { useCallback, useEffect, useState } from "react";

import type { GamePoolOperatorView } from "./types";
import { controlGamePoolAsOperatorFn, getGamePoolOperatorViewFn } from "./operator.functions";

export function GamePoolOperatorApp({
  token,
  initialView,
}: {
  token: string;
  initialView: GamePoolOperatorView;
}) {
  const [view, setView] = useState(initialView);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    setView(await getGamePoolOperatorViewFn({ data: { token } }));
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const control = async (action: "pause" | "resume" | "close" | "close-room", roomId?: string) => {
    try {
      const next = await controlGamePoolAsOperatorFn({ data: { token, action, roomId } });
      setView(next);
      setMessage(action === "close-room" ? "Room closed to new players." : "Admissions updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update admissions.");
    }
  };

  if (!view.found) return <main className="mx-auto max-w-2xl px-6 py-20">{view.message}</main>;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-xs theme-muted">game-night organizer</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">{view.label}</h1>
      <p className="mt-2 font-mono text-sm theme-muted">
        {view.game} · admissions {view.status}
      </p>
      <div className="mt-8 flex flex-wrap gap-3 border-y theme-border py-5">
        {view.status === "open" ? (
          <button
            type="button"
            onClick={() => void control("pause")}
            className="min-h-11 rounded-full border theme-border px-5 font-mono text-xs"
          >
            pause joins
          </button>
        ) : view.status === "paused" ? (
          <button
            type="button"
            onClick={() => void control("resume")}
            className="min-h-11 rounded-full border theme-border px-5 font-mono text-xs"
          >
            resume joins
          </button>
        ) : null}
        {view.status !== "closed" ? (
          <button
            type="button"
            onClick={() => void control("close")}
            className="min-h-11 px-3 font-mono text-xs underline"
          >
            close admissions
          </button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="mt-4 font-mono text-xs theme-muted">
          {message}
        </p>
      ) : null}
      <ul className="mt-8 divide-y theme-border">
        {view.rooms?.map((room) => (
          <li key={room.roomId} className="flex items-center justify-between gap-4 py-4">
            <div>
              <p className="font-serif text-lg">{room.label}</p>
              <p className="font-mono text-xs theme-muted">
                {room.status} · {room.playerCount}/{room.capacity}
              </p>
            </div>
            {room.status === "open" && view.status !== "closed" ? (
              <button
                type="button"
                onClick={() => void control("close-room", room.roomId)}
                className="min-h-11 font-mono text-xs underline"
              >
                stop filling
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
