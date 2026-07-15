import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createPartyRoomFn } from "./party-room.functions";
import type { PartyDeckSummary } from "./types";
import { SpellingDeckBuilder } from "../spelling-bee/SpellingDeckBuilder";
import { SpellingDeckPicker } from "../spelling-bee/SpellingDeckPicker";
import { SpellingSetupIntro } from "../spelling-bee/SpellingSetupIntro";
import type { CustomSpellingDeck } from "../spelling-bee/customDecks";
import { spellingRoundOptions } from "../spelling-bee/decks";
import { useCustomSpellingDecks } from "../spelling-bee/useCustomSpellingDecks";
import { readRecentSpellingWordIds, rememberSpellingWords } from "../spelling-bee/wordRotation.client";
import { gameBrowserKeys } from "../shared/game-keys";
import { writeExpiringLocalValue } from "../shared/game-storage.client";

export function PartySetupApp({ decks }: { decks: PartyDeckSummary[] }) {
  const navigate = useNavigate();
  const { customDecks, saveDeck, deleteDeck } = useCustomSpellingDecks();
  const [deckId, setDeckId] = useState(decks[0]?.id ?? "");
  const [answerSeconds, setAnswerSeconds] = useState(20);
  const [roundTotal, setRoundTotal] = useState(5);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [building, setBuilding] = useState(false);
  const [editingDeck, setEditingDeck] = useState<CustomSpellingDeck | null>(null);
  const selectedCustomDeck = customDecks.find(({ id }) => id === deckId);
  const deckItems = [
    ...decks,
    ...customDecks.map((deck) => ({ id: deck.id, name: deck.name, description: "Your words · saved on this device.", symbol: "✎", wordCount: deck.words.length })),
  ];
  const selectedWordCount = deckItems.find(({ id }) => id === deckId)?.wordCount ?? 3;
  const roundOptions = spellingRoundOptions(selectedWordCount);
  const selectDeck = (id: string) => {
    setDeckId(id);
    const wordCount = deckItems.find((deck) => deck.id === id)?.wordCount ?? 3;
    setRoundTotal((current) => Math.min(current, wordCount));
  };

  const handleCreate = async () => {
    if (!deckId || creating) return;
    setCreating(true); setMessage(null);
    try {
      const room = await createPartyRoomFn({ data: {
        deckId,
        customDeck: selectedCustomDeck ? { id: selectedCustomDeck.id, name: selectedCustomDeck.name, words: selectedCustomDeck.words } : undefined,
        recentWordIds: readRecentSpellingWordIds(deckId),
        answerSeconds,
        roundTotal,
      } });
      const recovery = { presenterToken: room.presenterToken, joinToken: room.joinToken };
      rememberSpellingWords(deckId, room.selectedWordIds, selectedWordCount);
      writeExpiringLocalValue(gameBrowserKeys.partyPresenterRecovery(room.roomId), recovery, room.expiresAt);
      const fragment = new URLSearchParams({ presenter: room.presenterToken, join: room.joinToken, expires: String(room.expiresAt) });
      await navigate({ to: "/things/spelling-party/$roomId/present", params: { roomId: room.roomId }, hash: fragment.toString() });
    } catch {
      setMessage("Could not make the room. Check your connection and try again.");
      setCreating(false);
    }
  };

  const handleCodeJoin = async () => {
    const roomId = joinCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{7}$/.test(roomId)) {
      setMessage("Enter the 7-character room code.");
      return;
    }
    await navigate({ to: "/things/spelling-party/$roomId", params: { roomId } });
  };

  if (building) return <SpellingDeckBuilder deck={editingDeck} saveLabel="save deck" onCancel={() => setBuilding(false)} onDelete={(deck) => { deleteDeck(deck.id); if (deckId === deck.id) setDeckId(decks[0]?.id ?? ""); setBuilding(false); }} onSave={(deck) => { saveDeck(deck); setDeckId(deck.id); setRoundTotal((current) => Math.min(current, deck.words.length)); setBuilding(false); }} />;

  return <div className="things-game things-game--night text-white">
    <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55"><Link to="/things" className="inline-flex min-h-11 items-center">← things</Link><span className="inline-flex min-h-11 items-center">type together</span></header>
    <main id="main" className="flex-1 px-5 pb-10">
      <SpellingSetupIntro mode="together" />
      <SpellingDeckPicker decks={deckItems} selectedDeckId={deckId} customDeckIds={new Set(customDecks.map(({ id }) => id))} onSelectDeck={selectDeck} onCreateDeck={() => { setEditingDeck(null); setBuilding(true); }} onEditDeck={(id) => { setEditingDeck(customDecks.find((deck) => deck.id === id) ?? null); setBuilding(true); }} />
      <section className="mx-auto mt-8 max-w-lg rounded-3xl border border-white/12 p-5" aria-labelledby="party-settings"><h2 id="party-settings" className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">round settings</h2>
        <label className="mt-5 flex min-h-11 items-center justify-between gap-4 font-mono text-xs text-white/65"><span>words this game</span><select value={Math.min(roundTotal, selectedWordCount)} onChange={(event) => setRoundTotal(Number(event.target.value))} className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-4">{roundOptions.map((value) => <option key={value} value={value}>{value === selectedWordCount ? `all ${value}` : value}</option>)}</select></label>
        <label className="mt-3 flex min-h-11 items-center justify-between gap-4 font-mono text-xs text-white/65"><span>typing time</span><select value={answerSeconds} onChange={(event) => setAnswerSeconds(Number(event.target.value))} className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-4">{[10, 15, 20, 30, 45].map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label>
      </section>
      <div className="mx-auto mt-8 max-w-lg"><button type="button" onClick={() => void handleCreate()} disabled={creating || !deckId} className="min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black disabled:opacity-40">{creating ? "making room…" : "create party room"}</button><p aria-live="polite" className="mt-3 min-h-5 text-center font-mono text-xs text-amber-200">{message}</p>
        <form onSubmit={(event) => { event.preventDefault(); void handleCodeJoin(); }} className="mt-8 border-t border-white/12 pt-8"><label htmlFor="party-room-code" className="block text-center font-serif text-xl font-semibold">Joining someone else?</label><p className="mt-1 text-center text-xs text-white/45">Enter the code shown on their shared screen.</p><div className="mt-4 grid grid-cols-[1fr_auto] gap-2"><input id="party-room-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 7))} autoCapitalize="characters" autoComplete="off" spellCheck={false} enterKeyHint="go" placeholder="ROOM CODE" aria-label="Room code" className="min-h-14 min-w-0 rounded-full border border-white/20 bg-white/[0.06] px-5 text-center font-mono text-base uppercase tracking-[0.16em] placeholder:text-white/30" /><button type="submit" disabled={joinCode.length !== 7} className="min-h-14 rounded-full border border-white/20 px-5 font-mono text-xs font-semibold disabled:opacity-35">join room</button></div></form>
        <p className="mt-6 text-center text-xs leading-relaxed text-white/40">Say It Aloud works offline. Type Together needs an internet connection for every phone.</p></div>
    </main>
  </div>;
}
