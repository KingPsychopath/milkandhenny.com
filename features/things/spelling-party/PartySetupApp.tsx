import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createPartyRoomFn } from "./party-room.functions";
import type { PartyDeckSummary } from "./types";
import { SpellingSetupIntro } from "../spelling-bee/SpellingSetupIntro";
import { gameBrowserKeys } from "../shared/game-keys";
import { writeExpiringLocalValue } from "../shared/game-storage.client";

export function PartySetupApp({ decks }: { decks: PartyDeckSummary[] }) {
  const navigate = useNavigate();
  const [deckId, setDeckId] = useState(decks[0]?.id ?? "");
  const [answerSeconds, setAnswerSeconds] = useState(20);
  const [roundTotal, setRoundTotal] = useState(5);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!deckId || creating) return;
    setCreating(true); setMessage(null);
    try {
      const room = await createPartyRoomFn({ data: { deckId, answerSeconds, roundTotal } });
      const recovery = { presenterToken: room.presenterToken, joinToken: room.joinToken };
      writeExpiringLocalValue(gameBrowserKeys.partyPresenterRecovery(room.roomId), recovery, room.expiresAt);
      const fragment = new URLSearchParams({ presenter: room.presenterToken, join: room.joinToken, expires: String(room.expiresAt) });
      await navigate({
        to: "/things/spelling-party/$roomId/present",
        params: { roomId: room.roomId },
        hash: fragment.toString(),
      });
    } catch { setMessage("Could not make the room. Check your connection and try again."); setCreating(false); }
  };

  return <div className="things-game things-game--night text-white">
    <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55"><Link to="/things" className="inline-flex min-h-11 items-center">← things</Link><span>type together</span></header>
    <main id="main" className="mx-auto w-full max-w-lg flex-1 px-5 pb-12">
      <SpellingSetupIntro mode="together" />
      <section className="mt-10" aria-labelledby="party-decks"><h2 id="party-decks" className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">choose words</h2><div className="mt-3 grid gap-3">
        {decks.map((deck) => <button key={deck.id} type="button" aria-pressed={deck.id === deckId} onClick={() => setDeckId(deck.id)} className={`grid min-h-20 grid-cols-[2.75rem_1fr_auto] items-center gap-3 rounded-3xl border p-4 text-left ${deck.id === deckId ? "border-white/60 bg-white/12" : "border-white/12 bg-white/[0.04]"}`}><span aria-hidden="true" className="font-serif text-2xl text-white/60">{deck.symbol}</span><span><span className="block font-serif text-xl font-semibold">{deck.name}</span><span className="mt-1 block text-xs leading-relaxed text-white/50">{deck.description}</span></span><span className="font-mono text-xs text-white/40">{deck.wordCount}</span></button>)}
      </div></section>
      <section className="mt-7 rounded-3xl border border-white/12 p-5" aria-labelledby="party-settings"><h2 id="party-settings" className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">round settings</h2>
        <label className="mt-5 flex min-h-11 items-center justify-between gap-4 font-mono text-xs text-white/65"><span>words</span><select value={roundTotal} onChange={(event) => setRoundTotal(Number(event.target.value))} className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-4">{[3, 5, 8, 10].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="mt-3 flex min-h-11 items-center justify-between gap-4 font-mono text-xs text-white/65"><span>typing time</span><select value={answerSeconds} onChange={(event) => setAnswerSeconds(Number(event.target.value))} className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-4">{[10, 15, 20, 30, 45].map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label>
      </section>
      <button type="button" onClick={() => void handleCreate()} disabled={creating || !deckId} className="mt-8 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black disabled:opacity-40">{creating ? "making room…" : "create party room"}</button>
      <p aria-live="polite" className="mt-3 min-h-5 text-center font-mono text-xs text-amber-200">{message}</p>
      <p className="mt-6 text-center text-xs leading-relaxed text-white/40">Say It Aloud works offline. Type Together needs an internet connection for every phone.</p>
    </main>
  </div>;
}
