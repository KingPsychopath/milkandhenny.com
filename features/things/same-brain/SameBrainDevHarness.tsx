import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AppSelect } from "@/components/AppSelect";
import {
  createSameBrainRoomFn,
  exportSameBrainRoomFn,
  forceSameBrainScoreFn,
  importSameBrainRoomFn,
  joinSameBrainRoomFn,
  startSameBrainScenarioFn,
} from "./same-brain-room.functions";
import { SAME_BRAIN_SCENARIOS, type SameBrainScenario } from "./same-brain-scenarios";
import { SameBrainRoom } from "./SameBrainRoomApp";
import type { SameBrainPlayerCredentials, SameBrainScoring } from "./types";
import { useActionDialog } from "@/hooks/useActionDialog";

/**
 * A whole table on one screen, for development only.
 *
 * Every panel is a real `SameBrainRoom` — the exact component a player gets on their phone, with its
 * own poll loop, its own wake socket and its own snapshot. The harness does nothing a player could
 * not do; it only spares you five phones.
 *
 * What it adds beyond the liars harness is the method switch. This game's open question is not "does
 * the state machine work" but "does the scorer agree with a human", and that is only answerable by
 * running the *same answers* through both methods and looking at the two reveals. So a scenario
 * carries its answers, and the row of method buttons reopens it unchanged with only the scoring
 * swapped. Any round can be re-run either way without retyping a thing.
 */
const NAMES = [
  "Abel",
  "Maya",
  "Daniel",
  "Priya",
  "Tom",
  "Ana",
  "Sam",
  "Ivy",
  "Leo",
  "Nina",
  "Otis",
  "Rue",
  "Sol",
  "Vic",
  "Wren",
  "Zaid",
];

const CAPTURES_KEY = "things:same-brain:v1:dev-captures";
const SHORT_TIMINGS = { prompt: 2_000, submit: 15_000, reveal: 8_000 };

interface Capture {
  label: string;
  savedAt: number;
  payload: unknown;
}

function readCaptures(): Capture[] {
  try {
    return JSON.parse(localStorage.getItem(CAPTURES_KEY) ?? "[]") as Capture[];
  } catch {
    return [];
  }
}

export function SameBrainDevHarness() {
  const [count, setCount] = useState(6);
  const [fast, setFast] = useState(true);
  const [scoring, setScoring] = useState<SameBrainScoring>("embedding");
  const [seats, setSeats] = useState<SameBrainPlayerCredentials[] | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [lastScenario, setLastScenario] = useState<SameBrainScenario | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prompt, dialog } = useActionDialog();

  useEffect(() => setCaptures(readCaptures()), []);

  const writeCaptures = (next: Capture[]) => {
    setCaptures(next);
    try {
      localStorage.setItem(CAPTURES_KEY, JSON.stringify(next));
    } catch {
      setError("capture too large for local storage — download it instead");
    }
  };

  const adopt = (result: {
    roomId: string;
    hostToken: string;
    seats: Array<{ name: string; playerId: string; playerToken: string }>;
  }) => {
    setHostToken(result.hostToken);
    setNames(result.seats.map(({ name }) => name));
    setSeats(
      result.seats.map((seat) => ({
        roomId: result.roomId,
        playerId: seat.playerId,
        playerToken: seat.playerToken,
        expiresAt: Date.now() + 60 * 60_000,
        snapshot: undefined as never,
      })),
    );
  };

  /** Opens a scenario, optionally overriding the method it was written for. */
  const openScenario = async (scenario: SameBrainScenario, method?: SameBrainScoring) => {
    setBusy(true);
    setError(null);
    try {
      const started = await startSameBrainScenarioFn({
        data: {
          names: NAMES.slice(0, scenario.players),
          rounds: scenario.id === "long-game" ? 3 : undefined,
          scoring: method ?? scenario.scoring ?? scoring,
          toggles: scenario.toggles,
          question: scenario.question,
          answers: scenario.answers,
          // A scenario's own timings win: if it exists to show a countdown, short phases would hide
          // the thing it exists to show.
          ...(fast || scenario.timings
            ? { timings: { ...(fast ? SHORT_TIMINGS : {}), ...scenario.timings } }
            : {}),
        },
      });
      if (started.error) {
        setError(started.error);
        return;
      }
      // Scenarios where only some seats answered still have an open submit; close it so the panel
      // opens on the reveal, which is the thing worth looking at.
      if (scenario.answers && Object.keys(scenario.answers).length < scenario.players)
        await forceSameBrainScoreFn({ data: { roomId: started.roomId } });
      setLastScenario(scenario);
      if (method) setScoring(method);
      adopt(started);
    } catch {
      setError("could not open that scenario");
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createSameBrainRoomFn({
        data: { scoring, ...(fast ? { timings: SHORT_TIMINGS } : {}) },
      });
      const joined: Array<{ name: string; playerId: string; playerToken: string }> = [];
      for (const name of NAMES.slice(0, count)) {
        const result = await joinSameBrainRoomFn({
          data: {
            roomId: created.roomId,
            joinToken: created.joinToken,
            name,
            joinId: `dev-${created.roomId}-${name}`,
          },
        });
        if (!result.ok) {
          setError(`${name}: ${result.error}`);
          continue;
        }
        joined.push({ name, playerId: result.playerId, playerToken: result.playerToken });
      }
      setLastScenario(null);
      adopt({ roomId: created.roomId, hostToken: created.hostToken, seats: joined });
    } catch {
      setError("could not open a room");
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (!seats || !hostToken) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await exportSameBrainRoomFn({
        data: {
          roomId: seats[0].roomId,
          hostToken,
          seats: seats.map((seat, index) => ({
            name: names[index] ?? NAMES[index],
            playerId: seat.playerId,
            playerToken: seat.playerToken,
          })),
        },
      });
      if (!payload) {
        setError("could not capture that room");
        return;
      }
      const label = await prompt({
        tone: "dark",
        eyebrow: "scenario capture",
        title: "Name this scenario",
        label: "Scenario name",
        defaultValue: `round · ${new Date().toLocaleTimeString()}`,
        confirmLabel: "save capture",
        required: true,
      });
      if (!label) return;
      writeCaptures([{ label, savedAt: Date.now(), payload }, ...captures].slice(0, 24));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (entry: Capture) => {
    setBusy(true);
    setError(null);
    try {
      const restored = await importSameBrainRoomFn({ data: { snapshot: entry.payload } });
      if (!restored) {
        setError("that capture could not be restored");
        return;
      }
      adopt(restored);
    } catch {
      setError("that capture could not be restored");
    } finally {
      setBusy(false);
    }
  };

  const download = (entry: Capture) => {
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `same-brain-${entry.label.replace(/\W+/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File) => {
    try {
      writeCaptures([JSON.parse(await file.text()) as Capture, ...captures].slice(0, 24));
    } catch {
      setError("that file is not a capture");
    }
  };

  return (
    <div className="min-h-svh bg-black p-3">
      <header className="flex flex-wrap items-center gap-3 pb-3 font-mono text-xs text-white/70">
        <span className="font-bold uppercase tracking-[0.2em] text-[var(--things-amber)]">
          same brain dev
        </span>
        {seats ? (
          <>
            <span className="text-white/45">{seats[0]?.roomId}</span>
            <span className="text-white/35">scoring: {scoring}</span>
            <span className="text-white/30">
              every panel is the real player surface · drive them exactly as a player would
            </span>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2">
              players
              <input
                type="number"
                min={3}
                max={16}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="w-14 border border-white/20 bg-transparent px-1 py-0.5"
              />
            </label>
            <label className="flex items-center gap-2">
              scoring
              <AppSelect
                value={scoring}
                onValueChange={(value) => setScoring(value as SameBrainScoring)}
                options={[
                  { value: "embedding", label: "embedding" },
                  { value: "exact", label: "exact" },
                ]}
                tone="night"
                variant="pill"
                ariaLabel="Scoring"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fast}
                onChange={(event) => setFast(event.target.checked)}
              />
              short phases
            </label>
          </>
        )}
        <span className="ml-auto flex gap-2">
          {seats ? (
            <>
              {/* The whole point of the harness: the same answers, the other method, one tap. */}
              {lastScenario ? (
                <Chip
                  onClick={() =>
                    void openScenario(lastScenario, scoring === "embedding" ? "exact" : "embedding")
                  }
                  disabled={busy}
                >
                  re-run as {scoring === "embedding" ? "exact" : "embedding"}
                </Chip>
              ) : null}
              <Chip onClick={() => void capture()} disabled={busy}>
                capture
              </Chip>
              <Chip onClick={() => setSeats(null)}>reset</Chip>
            </>
          ) : (
            <Chip onClick={() => void open()} disabled={busy}>
              {busy ? "opening…" : "open room"}
            </Chip>
          )}
        </span>
      </header>

      {error ? <p className="pb-2 font-mono text-xs text-[var(--liars-dead)]">{error}</p> : null}

      {seats ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {seats.map((credentials, index) => (
            <div key={credentials.playerId} className="shrink-0">
              <p className="pb-1 font-mono text-micro uppercase tracking-[0.16em] text-white/40">
                {names[index] ?? NAMES[index]}
                {index === 0 ? " · host" : ""}
              </p>
              {/* Phone-sized and independently scrollable, so each panel behaves like its own device. */}
              <div className="h-[780px] w-[375px] overflow-y-auto border border-white/15">
                <SameBrainRoom credentials={credentials} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="max-w-xl font-mono text-xs leading-relaxed text-white/45">
            Opens a real room, joins {count} players, and mounts the real player surface for each of
            them side by side — same server functions, same polling, same redactions as separate
            phones.
          </p>

          <section className="mt-6 max-w-3xl border-t border-white/15 pt-4">
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
              start from a position
            </p>
            <p className="mt-1 font-mono text-xs text-white/35">
              Answers included, already scored. Open one either way to see what the method changes —
              the same list is walked by the integration tests.
            </p>
            <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
              {SAME_BRAIN_SCENARIOS.map((scenario) => (
                <li key={scenario.id} className="border-t border-white/10 py-2">
                  <p className="flex items-baseline gap-2 font-mono text-xs">
                    <span className="text-white/80">{scenario.name}</span>
                    <span className="ml-auto text-white/25">{scenario.players}</span>
                  </p>
                  <p className="mt-1 font-mono text-xs leading-relaxed text-white/35">
                    {scenario.about}
                  </p>
                  <p className="mt-1 font-mono text-xs leading-relaxed text-white/25">
                    expects: {scenario.expect}
                  </p>
                  <span className="mt-2 flex gap-2">
                    <Chip onClick={() => void openScenario(scenario, "embedding")} disabled={busy}>
                      embedding
                    </Chip>
                    <Chip onClick={() => void openScenario(scenario, "exact")} disabled={busy}>
                      exact
                    </Chip>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6 max-w-xl border-t border-white/15 pt-4">
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
              saved scenarios
            </p>
            <p className="mt-1 font-mono text-xs text-white/35">
              Capture a room mid-game and come back to it whenever, instead of replaying three
              rounds to reach the state you wanted to look at.
            </p>
            <ul className="mt-3">
              {captures.length === 0 ? (
                <li className="py-2 font-mono text-xs text-white/30">nothing saved yet</li>
              ) : (
                captures.map((entry) => (
                  <li
                    key={`${entry.label}-${entry.savedAt}`}
                    className="flex items-center gap-3 border-t border-white/10 py-2 font-mono text-xs"
                  >
                    <span className="text-white/70">{entry.label}</span>
                    <span className="text-white/25">
                      {new Date(entry.savedAt).toLocaleString()}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <Chip onClick={() => void restore(entry)} disabled={busy}>
                        restore
                      </Chip>
                      <Chip onClick={() => download(entry)}>download</Chip>
                      <Chip
                        onClick={() =>
                          writeCaptures(captures.filter((each) => each.savedAt !== entry.savedAt))
                        }
                      >
                        delete
                      </Chip>
                    </span>
                  </li>
                ))
              )}
            </ul>
            <label className="mt-3 inline-flex min-h-8 cursor-pointer items-center border border-white/25 px-3 font-mono text-xs text-white/80 hover:border-[var(--things-amber)]">
              load a capture file
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
            </label>
          </section>
        </>
      )}
      {dialog}
    </div>
  );
}

function Chip({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-8 border border-white/25 px-3 font-mono text-xs text-white/80 hover:border-[var(--things-amber)] hover:text-[var(--things-amber)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
