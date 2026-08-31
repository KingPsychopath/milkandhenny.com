import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { writeExpiringLocalValue } from "../shared/game-storage.client";
import { FAMILY_FEUD_DECKS, FAMILY_FEUD_VIBES } from "./family-feud-content";
import { useFamilyFeudCustomDecks } from "./family-feud-custom-decks.client";
import { familyFeudPresenterFragment } from "./family-feud-invite";
import { familyFeudBrowserKeys } from "./family-feud-keys";
import {
  FAMILY_FEUD_MAIN_SECOND_OPTIONS,
  FAMILY_FEUD_ROUND_OPTIONS,
  FAMILY_FEUD_STEAL_SECOND_OPTIONS,
} from "./family-feud-rules";
import { createFamilyFeudRoomFn } from "./family-feud-room.functions";
import { FamilyFeudDeckBuilder } from "./FamilyFeudDeckBuilder";
import type { FamilyFeudCustomDeckInput, FamilyFeudVibeId } from "./types";
import { useSafeGameNavigation } from "../shared/useSafeGameNavigation";

export function FamilyFeudSetupApp() {
  useSafeGameNavigation(true);
  const navigate = useNavigate();
  const custom = useFamilyFeudCustomDecks();
  const [vibeId, setVibeId] = useState<FamilyFeudVibeId>("london-link-up");
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([
    "london-behaviour",
    "transport",
    "group-chat",
    "dating-in-london",
    "nightlife",
  ]);
  const [adultContent, setAdultContent] = useState(false);
  const [rounds, setRounds] = useState(6);
  const [mainSeconds, setMainSeconds] = useState(45);
  const [stealSeconds, setStealSeconds] = useState(10);
  const [teamOneName, setTeamOneName] = useState("");
  const [teamTwoName, setTeamTwoName] = useState("");
  const [teamOneCount, setTeamOneCount] = useState(4);
  const [teamTwoCount, setTeamTwoCount] = useState(4);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [builder, setBuilder] = useState<FamilyFeudCustomDeckInput | "new" | null>(null);
  const selectedCustom =
    selectedDeckIds.length === 1
      ? custom.decks.find(({ id }) => id === selectedDeckIds[0])
      : undefined;
  const decks = [
    ...FAMILY_FEUD_DECKS,
    ...custom.decks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      description: "Saved on this screen.",
      cardCount: deck.cards.length,
      adultOnly: false,
    })),
  ];
  if (builder)
    return (
      <FamilyFeudDeckBuilder
        deck={builder === "new" ? undefined : builder}
        onCancel={() => setBuilder(null)}
        onSave={(deck) => {
          custom.save(deck);
          setVibeId("choose-own");
          setSelectedDeckIds((selected) => [...new Set([...selected, deck.id])]);
          setBuilder(null);
        }}
        onDelete={(deck) => {
          custom.remove(deck.id);
          setSelectedDeckIds((selected) => selected.filter((deckId) => deckId !== deck.id));
          setBuilder(null);
        }}
      />
    );
  const createRoom = async () => {
    if (creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const room = await createFamilyFeudRoomFn({
        data: {
          vibeId,
          deckIds: vibeId === "choose-own" ? selectedDeckIds : undefined,
          customDecks:
            vibeId === "choose-own"
              ? custom.decks.filter(({ id }) => selectedDeckIds.includes(id))
              : undefined,
          adultContent,
          rounds,
          mainSeconds,
          stealSeconds,
          teams: [
            { name: teamOneName, playerCount: teamOneCount },
            { name: teamTwoName, playerCount: teamTwoCount },
          ],
        },
      });
      const presenterSession = {
        presenterToken: room.presenterToken,
        controllerPairingToken: room.controllerPairingToken,
        buzzerToken: room.buzzerToken,
        buzzerTokens: room.buzzerTokens,
      };
      writeExpiringLocalValue(
        familyFeudBrowserKeys.presenterRecovery(room.roomId),
        presenterSession,
        room.expiresAt,
      );
      await navigate({
        to: "/things/family-feud/$roomId/present",
        params: { roomId: room.roomId },
        hash: familyFeudPresenterFragment({
          token: room.presenterToken,
          controllerPairingToken: room.controllerPairingToken,
          buzzerToken: room.buzzerToken,
          buzzerTokens: room.buzzerTokens,
          expiresAt: room.expiresAt,
        }),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not make the room. Try again.");
      setCreating(false);
    }
  };
  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between px-6 py-5 font-mono text-xs text-white/55">
        <Link to="/things" className="inline-flex min-h-11 items-center">
          ← things
        </Link>
        <span>Family Feud</span>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-14">
        <div className="my-auto py-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
            two teams · one shared screen
          </p>
          <h1 className="mt-4 max-w-xl font-serif text-6xl font-semibold leading-[0.92] sm:text-7xl">
            Family Feud.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/65 sm:text-xl">
            We ranked ten answers from 10 points down to 1. Your teams shout the ones on the board;
            the MC judges and reveals from one phone.
          </p>
          <fieldset className="mt-10">
            <legend className="font-mono text-xs uppercase tracking-[0.18em] text-white/45">
              pick the room's vibe
            </legend>
            <div className="mt-3 grid gap-px overflow-hidden rounded-2xl bg-white/12 sm:grid-cols-2">
              {FAMILY_FEUD_VIBES.map((vibe) => (
                <button
                  key={vibe.id}
                  type="button"
                  onClick={() => setVibeId(vibe.id)}
                  aria-pressed={vibeId === vibe.id}
                  className={`min-h-28 bg-[var(--things-night)] p-5 text-left transition-opacity ${vibeId === vibe.id ? "ring-2 ring-inset ring-[var(--things-amber)]" : "hover:opacity-75"}`}
                >
                  <span className="block font-serif text-xl">{vibe.name}</span>
                  <span className="mt-1 block text-sm text-white/50">{vibe.description}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <label className="mt-6 flex min-h-14 cursor-pointer items-center justify-between gap-5 border-y border-white/12 py-3">
            <span>
              <span className="block font-serif text-lg">Include Slightly Spicy</span>
              <span className="mt-1 block text-sm text-white/45">
                18+ only · appears late and no more than twice
              </span>
            </span>
            <input
              type="checkbox"
              checked={adultContent}
              onChange={(event) => {
                setAdultContent(event.target.checked);
                if (!event.target.checked)
                  setSelectedDeckIds((selected) =>
                    selected.filter((deckId) => deckId !== "slightly-spicy"),
                  );
              }}
              className="h-6 w-6 accent-[var(--things-amber)]"
            />
          </label>
          {vibeId === "choose-own" ? (
            <fieldset className="mt-7">
              <legend className="font-mono text-xs uppercase tracking-[0.18em] text-white/45">
                decks in this mix
              </legend>
              <div className="mt-3 grid gap-px overflow-hidden rounded-2xl bg-white/12 sm:grid-cols-2">
                {decks.map((deck) => {
                  const disabled = deck.adultOnly && !adultContent;
                  const selected = selectedDeckIds.includes(deck.id);
                  return (
                    <button
                      key={deck.id}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setSelectedDeckIds((current) =>
                          current.includes(deck.id)
                            ? current.filter((deckId) => deckId !== deck.id)
                            : [...current, deck.id],
                        )
                      }
                      aria-pressed={selected}
                      className={`min-h-28 bg-[var(--things-night)] p-5 text-left transition-opacity disabled:opacity-30 ${selected ? "ring-2 ring-inset ring-[var(--things-amber)]" : "hover:opacity-75"}`}
                    >
                      <span className="block font-serif text-xl">{deck.name}</span>
                      <span className="mt-1 block text-sm text-white/50">{deck.description}</span>
                      <span className="mt-3 block font-mono text-[11px] text-white/35">
                        {deck.cardCount} cards{deck.adultOnly ? " · 18+" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 min-h-5 font-mono text-xs text-[var(--things-amber)]">
                {selectedDeckIds.length ? null : "Choose at least one deck."}
              </p>
            </fieldset>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-4 font-mono text-xs text-white/50">
            <button type="button" onClick={() => setBuilder("new")} className="min-h-11">
              + make a deck
            </button>
            {selectedCustom ? (
              <button type="button" onClick={() => setBuilder(selectedCustom)} className="min-h-11">
                edit selected deck
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOptionsOpen((open) => !open)}
              aria-expanded={optionsOpen}
              className="min-h-11"
            >
              {optionsOpen ? "hide options" : "game options"}
            </button>
          </div>
          {optionsOpen ? (
            <section className="mt-7 border-t border-white/12 pt-7" aria-label="Game options">
              <div className="grid gap-5 sm:grid-cols-3">
                <label className="font-mono text-xs text-white/55">
                  rounds
                  <AppSelect
                    value={rounds}
                    options={FAMILY_FEUD_ROUND_OPTIONS.map((value) => ({
                      value,
                      label: String(value),
                    }))}
                    onValueChange={(value) => setRounds(Number(value))}
                    tone="night"
                    variant="field"
                    className="mt-2"
                  />
                </label>
                <label className="font-mono text-xs text-white/55">
                  main round
                  <AppSelect
                    value={mainSeconds}
                    options={FAMILY_FEUD_MAIN_SECOND_OPTIONS.map((value) => ({
                      value,
                      label: `${value} seconds`,
                    }))}
                    onValueChange={(value) => setMainSeconds(Number(value))}
                    tone="night"
                    variant="field"
                    className="mt-2"
                  />
                </label>
                <label className="font-mono text-xs text-white/55">
                  steal
                  <AppSelect
                    value={stealSeconds}
                    options={FAMILY_FEUD_STEAL_SECOND_OPTIONS.map((value) => ({
                      value,
                      label: `${value} seconds`,
                    }))}
                    onValueChange={(value) => setStealSeconds(Number(value))}
                    tone="night"
                    variant="field"
                    className="mt-2"
                  />
                </label>
              </div>
              <fieldset className="mt-7">
                <legend className="font-mono text-xs text-white/55">teams and player slots</legend>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {[
                    {
                      name: teamOneName,
                      setName: setTeamOneName,
                      count: teamOneCount,
                      setCount: setTeamOneCount,
                      label: "Circle team",
                      colour: "var(--things-amber)",
                    },
                    {
                      name: teamTwoName,
                      setName: setTeamTwoName,
                      count: teamTwoCount,
                      setCount: setTeamTwoCount,
                      label: "Triangle team",
                      colour: "var(--things-frost)",
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/12 p-4">
                      <span className="font-mono text-xs" style={{ color: item.colour }}>
                        {item.label}
                      </span>
                      <input
                        value={item.name}
                        onChange={(event) => item.setName(event.target.value)}
                        maxLength={28}
                        placeholder="optional team name"
                        aria-label={`${item.label} name`}
                        className="mt-3 min-h-11 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3"
                      />
                      <label className="mt-3 flex items-center justify-between gap-3 font-mono text-xs text-white/50">
                        players
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={item.count}
                          onChange={(event) =>
                            item.setCount(Math.max(1, Math.min(20, Number(event.target.value))))
                          }
                          className="min-h-11 w-20 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-center text-white"
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-white/45">
                  Player counts only cap optional event-point claims; nobody needs a phone during
                  the game.
                </p>
              </fieldset>
            </section>
          ) : null}
          <button
            type="button"
            onClick={() => void createRoom()}
            disabled={
              creating || !custom.loaded || (vibeId === "choose-own" && !selectedDeckIds.length)
            }
            className="mt-9 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-semibold text-black transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {creating ? "making the room…" : "put Family Feud on this screen"}
          </button>
          <p className="mt-4 text-center text-sm text-white/45">
            Next, the TV shows a one-use QR for the MC’s phone.
          </p>
          <p
            aria-live="polite"
            className="mt-3 min-h-5 text-center font-mono text-xs text-[var(--things-amber)]"
          >
            {message}
          </p>
          <p className="mt-5 text-center text-xs leading-relaxed text-white/30">
            Original London cards, with a small adapted sample from{" "}
            <a
              href="https://github.com/iesl/protoqa-data"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-white/20 underline-offset-4"
            >
              ProtoQA's crowdsourced data
            </a>{" "}
            (CC BY 4.0).
          </p>
        </div>
      </main>
    </div>
  );
}
