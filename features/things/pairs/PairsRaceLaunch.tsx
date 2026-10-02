import { useGameNavigate } from "@/features/things/shared/useGameNavigate";
import { useState } from "react";
import { createPairsRaceFn } from "./pairs-race.functions";
import { savePairsRaceSession } from "./pairs-race-session.client";
import type { PairsSize } from "./pairs-rules";

export function PairsRaceLaunch({ pairCount }: { pairCount: PairsSize }) {
  const navigate = useGameNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createPairsRaceFn({ data: { name: name.trim(), pairCount } });
      if (!savePairsRaceSession(session))
        throw new Error("Allow browser storage to keep your player session, then try again.");
      await navigate({ to: "/things/pairs/race/$roomId", params: { roomId: session.roomId } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a table");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pairs-race-launch">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="pairs-race-field">
          your name
          <input
            required
            maxLength={24}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </label>
        <button type="submit" className="mh-action mh-action--primary pairs-deal" disabled={busy}>
          {busy ? "making a table…" : "create a race"}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const roomId = code.trim().toUpperCase();
          if (!/^[A-Z2-9]{7}$/.test(roomId)) {
            setError("Enter the 7-character table code");
            return;
          }
          void navigate({ to: "/things/pairs/race/$roomId", params: { roomId } });
        }}
      >
        <label className="pairs-race-field">
          or join a race
          <input
            required
            maxLength={7}
            placeholder="table code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
          />
        </label>
        <button type="submit" className="mh-action mh-action--secondary pairs-deal">
          join their table <span aria-hidden="true">→</span>
        </button>
      </form>
      {error ? (
        <p role="alert" className="pairs-small">
          {error}
        </p>
      ) : null}
    </div>
  );
}
