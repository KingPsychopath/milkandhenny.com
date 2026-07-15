import { useEffect, useState } from "react";
import type { PartySnapshot } from "./types";

export function useSynchronizedPartyStage(snapshot: PartySnapshot | null, clockOffset: number) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    const update = () => setNow(Date.now() + clockOffset);
    update();
    const interval = window.setInterval(update, 80);
    return () => window.clearInterval(interval);
  }, [clockOffset]);
  const round = snapshot?.round;
  if (!snapshot || !round) return { now, label: snapshot?.phase === "finished" ? "finished" : "waiting", seconds: null as number | null };
  if (snapshot.phase === "countdown") {
    if (now < round.countdownStartsAt) return { now, label: "get ready", seconds: null };
    if (now < round.audioPlaysAt) return { now, label: String(Math.max(1, Math.ceil((round.audioPlaysAt - now) / 1_000))), seconds: null };
    return { now, label: "listen", seconds: null };
  }
  if (snapshot.phase === "answer") return { now, label: "spell it", seconds: Math.max(0, Math.ceil((round.answerLocksAt - now) / 1_000)) };
  if (snapshot.phase === "locked") return { now, label: "locked in", seconds: null };
  if (snapshot.phase === "reveal") return { now, label: round.correctWord ?? "reveal", seconds: null };
  return { now, label: snapshot.phase, seconds: null };
}
