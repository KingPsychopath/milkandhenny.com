import { useState } from "react";
import { RaceTable } from "./PairsRaceApp";
import {
  capturePairsRaceFn,
  restorePairsRaceCaptureFn,
  startPairsRaceScenarioFn,
  stepPairsRaceBotFn,
} from "./pairs-race-dev.functions";
import type { PairsRaceSession } from "./pairs-race-session.client";
import { savePairsRaceSession } from "./pairs-race-session.client";

const SCENARIOS = ["lobby", "live race", "round reveal", "final result"] as const;
export function PairsRaceDevHarness() {
  const [seats, setSeats] = useState<PairsRaceSession[]>([]);
  const [capture, setCapture] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mount, setMount] = useState(0);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scenario failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="border-t theme-border mt-10 p-4" aria-label="Two-device race harness">
      <h2 className="font-serif text-2xl">two-device race · development</h2>
      <p className="font-mono text-xs my-3">
        Real player surfaces. Bot step advances one pair through the production command and steps
        past its reveal deadline.
      </p>
      <div className="flex flex-wrap gap-3">
        {SCENARIOS.map((scenario) => (
          <button
            type="button"
            key={scenario}
            disabled={busy}
            className="mh-action mh-action--secondary"
            onClick={() =>
              void run(async () => {
                setSeats(await startPairsRaceScenarioFn({ data: scenario }));
              })
            }
          >
            {scenario}
          </button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="grid gap-4 xl:grid-cols-2 mt-5">
        {seats.map((seat, index) => (
          <article
            key={`${seat.playerId}:${mount}`}
            data-role="racer"
            data-seat={index}
            className="border theme-border"
          >
            <div className="flex flex-wrap gap-2 p-3">
              <span className="font-mono text-xs self-center">
                seat {index + 1} · {index === 0 ? "Alex" : "Jo"}
              </span>
              <button
                type="button"
                className="mh-action mh-action--secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await stepPairsRaceBotFn({ data: seat });
                  })
                }
              >
                bot: one pair
              </button>
              <button
                type="button"
                className="mh-action mh-action--secondary"
                onClick={() => setMount(mount + 1)}
              >
                refresh surfaces
              </button>
              <button
                type="button"
                className="mh-action mh-action--secondary"
                onClick={() => {
                  savePairsRaceSession(seat);
                  window.open(`/things/pairs/race/${seat.roomId}`, "_blank", "noopener");
                }}
              >
                pop out seat
              </button>
            </div>
            <RaceTable session={seat} />
          </article>
        ))}
      </div>
      {seats[0] ? (
        <div className="flex flex-col gap-3 mt-5 max-w-2xl">
          <p className="font-mono text-xs">
            Captures contain hidden cards and local credentials. Development only; restore in the
            same server session. Restoring creates a new table and new credentials.
          </p>
          <button
            type="button"
            className="mh-action mh-action--secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setCapture(await capturePairsRaceFn({ data: seats[0] }));
              })
            }
          >
            capture this position
          </button>
          <label className="pairs-race-field">
            capture JSON
            <textarea
              rows={4}
              value={capture}
              onChange={(event) => setCapture(event.target.value)}
              className="border theme-border p-3 font-mono text-xs"
            />
          </label>
          <button
            type="button"
            className="mh-action mh-action--secondary"
            disabled={busy || !capture}
            onClick={() =>
              void run(async () => {
                setSeats(await restorePairsRaceCaptureFn({ data: capture }));
              })
            }
          >
            restore as new table
          </button>
        </div>
      ) : null}
    </section>
  );
}
