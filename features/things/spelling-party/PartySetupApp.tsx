import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createPartyRoomFn, joinPartyRoomFn } from "./party-room.functions";
import type { PartyDeckSummary } from "./types";
import { SpellingDeckBuilder } from "../spelling/SpellingDeckBuilder";
import { SpellingDeckPicker } from "../spelling/SpellingDeckPicker";
import type { CustomSpellingDeck } from "../spelling/customDecks";
import { AppSelect } from "@/components/AppSelect";
import { spellingRoundOptions } from "../spelling/decks";
import { useCustomSpellingDecks } from "../spelling/useCustomSpellingDecks";
import { readRecentSpellingWordIds, rememberSpellingWords } from "../spelling/wordRotation.client";
import { partyBrowserKeys } from "./party-keys";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { useUpdateReloadSafety } from "@/features/offline/update-safety.client";
import { partyPresenterFragment } from "./party-invite";
import {
  GameLaunch,
  GameLaunchButton,
  GameLaunchChoices,
  GameLaunchMeta,
} from "../shared/GameLaunch";
import { RoomJoinControl } from "../shared/RoomJoinControl";

export function PartySetupApp({ decks }: { decks: PartyDeckSummary[] }) {
  const navigate = useNavigate();
  const { customDecks, saveDeck, deleteDeck } = useCustomSpellingDecks();
  const [deckId, setDeckId] = useState(decks[0]?.id ?? "");
  const [answerSeconds, setAnswerSeconds] = useState(20);
  const [roundTotal, setRoundTotal] = useState(5);
  const [deviceRole, setDeviceRole] = useState<"play" | "screen">("play");
  const [playerName, setPlayerName] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [building, setBuilding] = useState(false);
  const [editingDeck, setEditingDeck] = useState<CustomSpellingDeck | null>(null);
  const [panel, setPanel] = useState<"host" | "join" | "options" | null>(null);
  useUpdateReloadSafety("spelling-party-setup", !building);
  const selectedCustomDeck = customDecks.find(({ id }) => id === deckId);
  const deckItems = [
    ...decks,
    ...customDecks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      description: "Your words · saved on this device.",
      symbol: "✎",
      wordCount: deck.words.length,
    })),
  ];
  const selectedWordCount = deckItems.find(({ id }) => id === deckId)?.wordCount ?? 3;
  const selectedDeckName = deckItems.find(({ id }) => id === deckId)?.name ?? "Warm-up words";
  const roundOptions = spellingRoundOptions(selectedWordCount);
  const selectDeck = (id: string) => {
    setDeckId(id);
    const wordCount = deckItems.find((deck) => deck.id === id)?.wordCount ?? 3;
    setRoundTotal((current) => Math.min(current, wordCount));
  };

  const handleCreate = async () => {
    if (!deckId || creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const room = await createPartyRoomFn({
        data: {
          deckId,
          customDeck: selectedCustomDeck
            ? {
                id: selectedCustomDeck.id,
                name: selectedCustomDeck.name,
                words: selectedCustomDeck.words,
              }
            : undefined,
          recentWordIds: readRecentSpellingWordIds(deckId),
          answerSeconds,
          roundTotal,
        },
      });
      const recovery = { presenterToken: room.presenterToken, joinToken: room.joinToken };
      rememberSpellingWords(deckId, room.selectedWordIds, selectedWordCount);
      writeExpiringLocalValue(
        partyBrowserKeys.presenterRecovery(room.roomId),
        recovery,
        room.expiresAt,
      );
      if (deviceRole === "play") {
        const joined = await joinPartyRoomFn({
          data: {
            roomId: room.roomId,
            joinToken: room.joinToken,
            presenterToken: room.presenterToken,
            name: playerName,
            joinId: crypto.randomUUID(),
          },
        });
        if (!joined.ok) throw new Error(joined.error);
        const credentials = { ...joined, presenterToken: room.presenterToken };
        sessionStorage.setItem(partyBrowserKeys.invite(room.roomId), room.joinToken);
        writeExpiringLocalValue(
          partyBrowserKeys.playerSession(room.roomId),
          credentials,
          room.expiresAt,
        );
        await navigate({ to: "/things/spelling-party/$roomId", params: { roomId: room.roomId } });
        return;
      }
      await navigate({
        to: "/things/spelling-party/$roomId/present",
        params: { roomId: room.roomId },
        hash: partyPresenterFragment({
          presenterToken: room.presenterToken,
          joinToken: room.joinToken,
          expiresAt: room.expiresAt,
        }),
      });
    } catch {
      setMessage("Could not make the room. Check your connection and try again.");
      setCreating(false);
    }
  };

  const handleCodeJoin = async (code = joinCode) => {
    const roomId = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{7}$/.test(roomId)) {
      setMessage("Enter the 7-character room code.");
      return;
    }
    await navigate({ to: "/things/spelling-party/$roomId", params: { roomId } });
  };

  if (building)
    return (
      <SpellingDeckBuilder
        deck={editingDeck}
        saveLabel="save deck"
        onCancel={() => setBuilding(false)}
        onDelete={(deck) => {
          deleteDeck(deck.id);
          if (deckId === deck.id) setDeckId(decks[0]?.id ?? "");
          setBuilding(false);
        }}
        onSave={(deck) => {
          saveDeck(deck);
          setDeckId(deck.id);
          setRoundTotal((current) => Math.min(current, deck.words.length));
          setBuilding(false);
        }}
      />
    );

  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55">
        <Link to="/things" className="inline-flex min-h-11 items-center">
          ← things
        </Link>
        <span className="inline-flex min-h-11 items-center">type together</span>
      </header>
      <main id="main" className="flex-1 px-5 pb-10">
        <GameLaunch
          tone="night"
          eyebrow="spelling bee · type together"
          title="Spelling Bee."
          description="Listen together. Type your answer. Reveal everyone's spelling."
        >
          <GameLaunchButton
            accent="amber"
            onClick={() => {
              setMessage(null);
              if (deviceRole === "screen") void handleCreate();
              else setPanel("host");
            }}
            disabled={creating}
          >
            {creating
              ? "making room…"
              : deviceRole === "screen"
                ? "create shared screen"
                : "start a room"}
          </GameLaunchButton>
          <GameLaunchMeta tone="dark">
            {selectedDeckName} · {Math.min(roundTotal, selectedWordCount)} words · {answerSeconds}{" "}
            seconds
          </GameLaunchMeta>
          <GameLaunchChoices tone="dark">
            <button
              type="button"
              onClick={() => setPanel(panel === "join" ? null : "join")}
              aria-pressed={panel === "join"}
              className="min-h-11"
            >
              join a room
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "options" ? null : "options")}
              aria-pressed={panel === "options"}
              className="min-h-11"
            >
              options
            </button>
            <Link to="/things/spelling-bee" className="inline-flex min-h-11 items-center">
              say it aloud →
            </Link>
          </GameLaunchChoices>
        </GameLaunch>

        {panel === "host" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
            className="mx-auto mt-10 max-w-lg border-t border-white/12 pt-7"
            aria-labelledby="host-room"
          >
            <h2 id="host-room" className="font-serif text-3xl font-semibold">
              Your name
            </h2>
            <input
              id="host-player-name"
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              maxLength={24}
              autoFocus
              autoComplete="name"
              enterKeyHint="go"
              placeholder="Your name"
              aria-label="Your player name"
              className="mt-5 min-h-14 w-full rounded-full border border-white/20 bg-white/[0.06] px-5 text-center font-serif text-xl placeholder:text-white/30"
            />
            <GameLaunchButton
              accent="amber"
              type="submit"
              disabled={creating || !deckId || !playerName.trim()}
              className="mt-4"
            >
              {creating ? "making room…" : "create room"}
            </GameLaunchButton>
            <p
              aria-live="polite"
              className="mt-3 min-h-5 text-center font-mono text-xs text-amber-200"
            >
              {message}
            </p>
          </form>
        ) : null}

        {panel === "join" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-white/12 pt-7"
            aria-label="Join a room"
          >
            <RoomJoinControl
              value={joinCode}
              gamePath="/things/spelling-party"
              tone="dark"
              message={message}
              onValueChange={(value) => {
                setJoinCode(value);
                setMessage(null);
              }}
              onJoin={handleCodeJoin}
            />
          </section>
        ) : null}

        {panel === "options" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-white/12 pt-7"
            aria-labelledby="party-settings"
          >
            <h2 id="party-settings" className="font-serif text-3xl font-semibold">
              Options
            </h2>
            <SpellingDeckPicker
              decks={deckItems}
              selectedDeckId={deckId}
              customDeckIds={new Set(customDecks.map(({ id }) => id))}
              onSelectDeck={selectDeck}
              onCreateDeck={() => {
                setEditingDeck(null);
                setBuilding(true);
              }}
              onEditDeck={(id) => {
                setEditingDeck(customDecks.find((deck) => deck.id === id) ?? null);
                setBuilding(true);
              }}
            />
            <div className="mt-8 rounded-3xl border border-white/12 p-5">
              <label className="flex min-h-11 items-center justify-between gap-4 font-mono text-xs text-white/65">
                <span>words</span>
                <AppSelect
                  value={Math.min(roundTotal, selectedWordCount)}
                  onValueChange={(value) => setRoundTotal(Number(value))}
                  ariaLabel="Words per round"
                  tone="night"
                  options={roundOptions.map((value) => ({
                    value,
                    label: value === selectedWordCount ? `all ${value}` : String(value),
                  }))}
                />
              </label>
              <label className="mt-3 flex min-h-11 items-center justify-between gap-4 font-mono text-xs text-white/65">
                <span>typing time</span>
                <AppSelect
                  value={answerSeconds}
                  onValueChange={(value) => setAnswerSeconds(Number(value))}
                  ariaLabel="Typing time"
                  tone="night"
                  options={[10, 15, 20, 30, 45].map((value) => ({
                    value,
                    label: `${value} seconds`,
                  }))}
                />
              </label>
            </div>
            <fieldset className="mt-8">
              <legend className="font-serif text-2xl font-semibold">This device</legend>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label
                  className={`cursor-pointer rounded-3xl border p-4 ${deviceRole === "play" ? "border-amber-300/60 bg-amber-300/[0.08]" : "border-white/12"}`}
                >
                  <span className="flex items-center gap-3 font-mono text-sm font-semibold">
                    <input
                      type="radio"
                      name="device-role"
                      value="play"
                      checked={deviceRole === "play"}
                      onChange={() => setDeviceRole("play")}
                      className="h-5 w-5 accent-[var(--things-amber)]"
                    />
                    play too
                  </span>
                </label>
                <label
                  className={`cursor-pointer rounded-3xl border p-4 ${deviceRole === "screen" ? "border-amber-300/60 bg-amber-300/[0.08]" : "border-white/12"}`}
                >
                  <span className="flex items-center gap-3 font-mono text-sm font-semibold">
                    <input
                      type="radio"
                      name="device-role"
                      value="screen"
                      checked={deviceRole === "screen"}
                      onChange={() => setDeviceRole("screen")}
                      className="h-5 w-5 accent-[var(--things-amber)]"
                    />
                    shared screen
                  </span>
                </label>
              </div>
            </fieldset>
            <GameLaunchButton
              accent="amber"
              onClick={() => (deviceRole === "screen" ? void handleCreate() : setPanel("host"))}
              disabled={creating || !deckId}
              className="mt-8"
            >
              {creating
                ? "making room…"
                : deviceRole === "screen"
                  ? "create shared screen"
                  : "start a room"}
            </GameLaunchButton>
            <p
              aria-live="polite"
              className="mt-3 min-h-5 text-center font-mono text-xs text-amber-200"
            >
              {message}
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
