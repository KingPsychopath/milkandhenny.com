import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { createDrawCountryRoomFn } from "./draw-country-room.functions";
import { drawCountryBrowserKeys } from "./draw-country-keys";
import { recentCountryIds } from "./rotation.client";
import { SoloDrawCountry } from "./SoloDrawCountry";

export function DrawCountryApp() {
  const navigate = useNavigate();
  const haptics = useWebHaptics();
  const [solo, setSolo] = useState(false);
  const [name, setName] = useState("");
  const [roundTotal, setRoundTotal] = useState(5);
  const [drawSeconds, setDrawSeconds] = useState(30);
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (solo) return <SoloDrawCountry onExit={() => setSolo(false)} />;

  const handleCreate = async () => {
    if (!name.trim() || creating) {
      setMessage("Add your name to make a room.");
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const room = await createDrawCountryRoomFn({
        data: {
          hostName: name,
          roundTotal,
          drawSeconds,
          recentCountryIds: recentCountryIds(),
        },
      });
      sessionStorage.setItem(drawCountryBrowserKeys.invite(room.roomId), room.joinToken);
      writeExpiringLocalValue(
        drawCountryBrowserKeys.playerSession(room.roomId),
        {
          roomId: room.roomId,
          playerId: room.playerId,
          playerToken: room.playerToken,
          expiresAt: room.expiresAt,
          snapshot: room.snapshot,
        },
        room.expiresAt,
      );
      void haptics.trigger("success");
      await navigate({ to: "/things/draw-country/$roomId", params: { roomId: room.roomId } });
    } catch {
      setCreating(false);
      setMessage("Could not make the room. Check your connection and try again.");
    }
  };

  const handleJoin = async () => {
    const roomId = joinCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{7}$/.test(roomId)) {
      setMessage("Enter the 7-character room code.");
      return;
    }
    await navigate({ to: "/things/draw-country/$roomId", params: { roomId } });
  };

  return (
    <div className="things-game things-game--cream text-black">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 pt-4 font-mono text-xs text-black/50">
        <Link to="/things" className="inline-flex min-h-11 items-center">
          ← things
        </Link>
        <span>draw the country</span>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl px-5 pb-16 pt-10 sm:pt-16">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-black/40">
          195 borders · from memory
        </p>
        <h1 className="mt-4 max-w-2xl font-serif text-5xl font-semibold leading-[0.98] tracking-tight sm:text-7xl">
          How well do you remember a country?
        </h1>
        <p className="mt-6 max-w-xl font-serif text-lg leading-relaxed text-black/60">
          Draw its outline in thirty seconds. We align the scale, compare both borders, and show
          exactly where you wandered.
        </p>

        <section className="mt-12 border-t border-black/15 pt-7" aria-labelledby="solo-mode">
          <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <p className="font-mono text-micro uppercase tracking-[0.18em] text-black/40">
                01 · on this device
              </p>
              <h2 id="solo-mode" className="mt-2 font-serif text-3xl font-semibold">
                play solo
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-black/55">
                Endless countries with a smart rotation that avoids recent repeats. Fully available
                offline.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSolo(true);
                void haptics.trigger("selection");
              }}
              className="min-h-12 rounded-full bg-black px-7 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white"
            >
              start solo
            </button>
          </div>
        </section>

        <section className="mt-10 border-t border-black/15 pt-7" aria-labelledby="together-mode">
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-black/40">
            02 · shared room
          </p>
          <h2 id="together-mode" className="mt-2 font-serif text-3xl font-semibold">
            play with friends
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-black/55">
            Everyone draws the same country on their own screen. Scores reveal together, then the
            room moves to the next round automatically.
          </p>
          <div className="mt-6 grid gap-4 rounded-[1.75rem] border border-black/15 bg-white/25 p-5 sm:grid-cols-3">
            <label className="font-mono text-xs text-black/55">
              <span className="block pb-2">your name</span>
              <input
                value={name}
                maxLength={32}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
                className="min-h-12 w-full rounded-full border border-black/15 bg-white/55 px-4 text-black"
              />
            </label>
            <label className="font-mono text-xs text-black/55">
              <span className="block pb-2">rounds</span>
              <select
                value={roundTotal}
                onChange={(event) => setRoundTotal(Number(event.target.value))}
                className="min-h-12 w-full rounded-full border border-black/15 bg-white/55 px-4 text-black"
              >
                {[3, 5, 7, 10].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="font-mono text-xs text-black/55">
              <span className="block pb-2">draw time</span>
              <select
                value={drawSeconds}
                onChange={(event) => setDrawSeconds(Number(event.target.value))}
                className="min-h-12 w-full rounded-full border border-black/15 bg-white/55 px-4 text-black"
              >
                {[20, 30, 45, 60].map((value) => (
                  <option key={value} value={value}>
                    {value} seconds
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreate()}
              className="min-h-12 rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-40 sm:col-span-3"
            >
              {creating ? "making room…" : "create room & play"}
            </button>
          </div>

          <div className="mt-7 flex items-end gap-3 border-t border-black/10 pt-6">
            <label className="min-w-0 flex-1 font-mono text-xs text-black/55">
              <span className="block pb-2">or join with a room code</span>
              <input
                value={joinCode}
                maxLength={7}
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                className="min-h-12 w-full rounded-full border border-black/15 bg-white/55 px-5 font-mono uppercase tracking-[0.18em] text-black"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleJoin()}
              className="min-h-12 rounded-full border border-black/25 px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em]"
            >
              join
            </button>
          </div>
          {message ? (
            <p role="status" className="mt-4 font-mono text-xs text-amber-800">
              {message}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
