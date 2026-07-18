import { AppSelect } from "@/components/AppSelect";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { createDrawCountryRoomFn } from "./draw-country-room.functions";
import { drawCountryBrowserKeys } from "./draw-country-keys";
import { recentCountryIds } from "./rotation.client";
import { SoloDrawCountry } from "./SoloDrawCountry";
import {
  GameLaunch,
  GameLaunchButton,
  GameLaunchChoices,
  GameLaunchMeta,
} from "../shared/GameLaunch";

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
  const [panel, setPanel] = useState<"friends" | "join" | null>(null);

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
          hostName: name.trim(),
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
      <main id="main" className="mx-auto w-full max-w-3xl px-5 pb-16 pt-3 sm:pt-8">
        <GameLaunch
          tone="cream"
          eyebrow="from memory"
          title="How well do you remember a country?"
          description="Draw its outline in thirty seconds and see how close you get."
        >
          <GameLaunchButton
            accent="ink"
            onClick={() => {
              setSolo(true);
              void haptics.trigger("selection");
            }}
          >
            start
          </GameLaunchButton>
          <GameLaunchMeta tone="light">30 seconds · works offline</GameLaunchMeta>
          <GameLaunchChoices tone="light">
            <button
              type="button"
              onClick={() => setPanel(panel === "friends" ? null : "friends")}
              aria-pressed={panel === "friends"}
              className="min-h-11"
            >
              play with friends
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "join" ? null : "join")}
              aria-pressed={panel === "join"}
              className="min-h-11"
            >
              join a room
            </button>
          </GameLaunchChoices>
        </GameLaunch>

        {panel === "friends" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-black/15 pt-7"
            aria-labelledby="together-mode"
          >
            <h2 id="together-mode" className="font-serif text-3xl font-semibold">
              Play with friends
            </h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreate();
              }}
              className="mt-5 grid gap-4 rounded-[1.75rem] border border-black/15 bg-white/25 p-5 sm:grid-cols-3"
            >
              <label className="font-mono text-xs text-black/55">
                <span className="block pb-2">your name</span>
                <input
                  name="playerName"
                  value={name}
                  maxLength={32}
                  required
                  autoComplete="name"
                  enterKeyHint="go"
                  onChange={(event) => {
                    setName(event.target.value);
                    setMessage(null);
                  }}
                  className="min-h-12 w-full rounded-full border border-black/15 bg-white/55 px-4 text-black"
                />
              </label>
              <label className="font-mono text-xs text-black/55">
                <span className="block pb-2">rounds</span>
                <AppSelect
                  value={roundTotal}
                  onValueChange={(value) => setRoundTotal(Number(value))}
                  ariaLabel="Rounds"
                  tone="cream"
                  className="min-h-12 w-full"
                  options={[3, 5, 7, 10].map((value) => ({ value, label: String(value) }))}
                />
              </label>
              <label className="font-mono text-xs text-black/55">
                <span className="block pb-2">draw time</span>
                <AppSelect
                  value={drawSeconds}
                  onValueChange={(value) => setDrawSeconds(Number(value))}
                  ariaLabel="Draw time"
                  tone="cream"
                  className="min-h-12 w-full"
                  options={[20, 30, 45, 60].map((value) => ({ value, label: `${value} seconds` }))}
                />
              </label>
              <button
                type="submit"
                disabled={creating}
                className="min-h-12 rounded-full bg-black px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-40 sm:col-span-3"
              >
                {creating ? "making room…" : "create room"}
              </button>
            </form>
            {message ? (
              <p role="status" className="mt-4 font-mono text-xs text-amber-800">
                {message}
              </p>
            ) : null}
          </section>
        ) : null}

        {panel === "join" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-black/15 pt-7"
            aria-labelledby="join-room"
          >
            <h2 id="join-room" className="font-serif text-3xl font-semibold">
              Room code
            </h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleJoin();
              }}
              className="mt-5 flex items-end gap-3"
            >
              <label className="min-w-0 flex-1 font-mono text-xs text-black/55">
                <span className="sr-only">room code</span>
                <input
                  name="roomCode"
                  value={joinCode}
                  maxLength={7}
                  minLength={7}
                  pattern="[A-Z2-9]{7}"
                  required
                  title="Enter the 7-character room code"
                  autoCapitalize="characters"
                  enterKeyHint="go"
                  spellCheck={false}
                  onChange={(event) => {
                    setJoinCode(event.target.value.toUpperCase());
                    setMessage(null);
                  }}
                  className="min-h-12 w-full rounded-full border border-black/15 bg-white/55 px-5 font-mono uppercase tracking-[0.18em] text-black"
                />
              </label>
              <button
                type="submit"
                className="min-h-12 rounded-full border border-black/25 px-6 font-mono text-xs font-semibold uppercase tracking-[0.14em]"
              >
                join
              </button>
            </form>
            {message ? (
              <p role="status" className="mt-4 font-mono text-xs text-amber-800">
                {message}
              </p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
