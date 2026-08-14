import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { createPresentationRoomFn } from "../presentation.functions";

export function PresentationSetup({ authorised }: { authorised: boolean }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("The Pitch Night");
  const [creating, setCreating] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => setHydrated(true), []);

  async function create() {
    setCreating(true);
    setMessage("");
    try {
      const room = await createPresentationRoomFn({ data: { eventTitle: title } });
      if (!room.ok) {
        setMessage(room.error);
        setCreating(false);
        return;
      }
      sessionStorage.setItem(
        `pitch-presenter:${room.value.credentials.roomId}`,
        room.value.credentials.hostToken,
      );
      await navigate({
        to: "/things/pitches/present/$roomId",
        params: { roomId: room.value.credentials.roomId },
        hash: `host=${encodeURIComponent(room.value.credentials.hostToken)}`,
      });
    } catch {
      setMessage("Could not open a presentation room. Check Redis and try again.");
      setCreating(false);
    }
  }

  if (!authorised) {
    return (
      <main id="main" className="mx-auto min-h-screen max-w-xl px-6 py-20">
        <Link to="/things/pitches" className="font-mono text-xs theme-muted hover:opacity-60">
          ← pitch wall
        </Link>
        <h1 className="mt-16 font-serif text-5xl text-foreground">
          The big screen belongs to the host.
        </h1>
        <p className="mt-5 font-serif text-lg theme-muted">
          Sign in as admin first, then return here to open a presentation room.
        </p>
        <Link
          to="/admin"
          search={{ view: "events" }}
          className="mt-10 inline-flex min-h-12 items-center border-b theme-border-strong font-mono text-sm text-foreground"
        >
          admin sign in →
        </Link>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <Link to="/things/pitches" className="font-mono text-xs theme-muted hover:opacity-60">
        ← pitch wall
      </Link>
      <p className="mt-16 font-mono text-micro uppercase tracking-[0.18em] theme-muted">
        big screen mode
      </p>
      <h1 className="mt-3 font-serif text-5xl text-foreground sm:text-6xl">
        Put the room in someone&apos;s hand.
      </h1>
      <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed theme-muted">
        Open this on the display. A presenter scans the code, asks for control, chooses their pitch,
        then moves through it from their phone.
      </p>
      <label className="mt-12 block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
        name on the display
        <input
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-3 block min-h-14 w-full border-b theme-border-strong bg-transparent font-serif text-3xl normal-case tracking-normal text-foreground outline-none focus:border-foreground"
        />
      </label>
      <button
        type="button"
        disabled={!hydrated || creating}
        onClick={() => void create()}
        className="mt-10 min-h-13 w-full bg-foreground px-6 font-mono text-sm text-background hover:opacity-80 disabled:opacity-40"
      >
        {creating ? "opening the screen…" : "open presentation screen →"}
      </button>
      {message ? (
        <p className="mt-4 font-mono text-sm text-red-700 dark:text-red-300">{message}</p>
      ) : null}
    </main>
  );
}
