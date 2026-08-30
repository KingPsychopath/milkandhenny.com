import { useMemo, useState } from "react";

import type { FamilyFeudCustomDeckInput } from "./types";

type AnswerDraft = { label: string; aliases: string };
type CardDraft = { id: string; prompt: string; answers: AnswerDraft[] };

const blankAnswers = () =>
  Array.from({ length: 10 }, () => ({ label: "", aliases: "" }) satisfies AnswerDraft);

function blankCard(): CardDraft {
  return { id: crypto.randomUUID(), prompt: "", answers: blankAnswers() };
}

function draftFromDeck(deck?: FamilyFeudCustomDeckInput): CardDraft[] {
  if (!deck) return Array.from({ length: 4 }, blankCard);
  return deck.cards.map((card) => ({
    id: card.id,
    prompt: card.prompt,
    answers: card.answers.map((answer) => ({
      label: answer.label,
      aliases: answer.aliases.join(", "),
    })),
  }));
}

export function FamilyFeudDeckBuilder({
  deck,
  onSave,
  onCancel,
  onDelete,
}: {
  deck?: FamilyFeudCustomDeckInput;
  onSave: (deck: FamilyFeudCustomDeckInput) => void;
  onCancel: () => void;
  onDelete?: (deck: FamilyFeudCustomDeckInput) => void;
}) {
  const [name, setName] = useState(deck?.name ?? "My Family Feud deck");
  const [cards, setCards] = useState(() => draftFromDeck(deck));
  const [openCard, setOpenCard] = useState(0);
  const valid = useMemo(
    () =>
      Boolean(name.trim()) &&
      cards.length >= 4 &&
      cards.every(
        (card) =>
          Boolean(card.prompt.trim()) &&
          card.answers.length === 10 &&
          card.answers.every((answer) => Boolean(answer.label.trim())),
      ),
    [cards, name],
  );
  const updateCard = (index: number, next: CardDraft) =>
    setCards((current) => current.map((card, cardIndex) => (cardIndex === index ? next : card)));
  const save = () => {
    if (!valid) return;
    onSave({
      id: deck?.id ?? `custom:${crypto.randomUUID()}`,
      name: name.trim(),
      cards: cards.map((card, cardIndex) => ({
        id: `custom:${deck?.id ?? "new"}:card:${cardIndex + 1}:${card.id}`,
        prompt: card.prompt.trim(),
        answers: card.answers.map((answer, answerIndex) => ({
          id: `custom:${card.id}:answer:${answerIndex + 1}`,
          label: answer.label.trim(),
          aliases: answer.aliases
            .split(",")
            .map((alias) => alias.trim())
            .filter(Boolean),
        })),
      })),
    });
  };
  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between px-6 py-5 font-mono text-xs text-white/55">
        <button type="button" onClick={onCancel} className="min-h-11">
          ← setup
        </button>
        <span>custom deck</span>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl px-6 pb-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
          Family Feud deck builder
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold sm:text-5xl">Make the room yours.</h1>
        <p className="mt-4 max-w-xl text-white/65">
          Every card needs one clear prompt and exactly ten accepted answers. Add alternate ways
          people might say an answer as comma-separated aliases.
        </p>
        <label className="mt-9 block font-mono text-xs text-white/55" htmlFor="deck-name">
          deck name
        </label>
        <input
          id="deck-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={48}
          className="mt-2 min-h-14 w-full rounded-xl border border-white/15 bg-white/[0.04] px-4 font-serif text-xl"
        />
        <div className="mt-10 space-y-3">
          {cards.map((card, cardIndex) => {
            const open = openCard === cardIndex;
            const complete =
              Boolean(card.prompt.trim()) && card.answers.every(({ label }) => label.trim());
            return (
              <section key={card.id} className="border-t border-white/12 pt-3">
                <button
                  type="button"
                  onClick={() => setOpenCard(open ? -1 : cardIndex)}
                  aria-expanded={open}
                  className="flex min-h-12 w-full items-center justify-between gap-4 text-left"
                >
                  <span className="font-serif text-xl">
                    {cardIndex + 1}. {card.prompt.trim() || "Untitled card"}
                  </span>
                  <span className="font-mono text-xs text-white/45">
                    {complete
                      ? "ready"
                      : `${card.answers.filter(({ label }) => label.trim()).length}/10`}
                  </span>
                </button>
                {open ? (
                  <div className="pb-7">
                    <label
                      className="mt-3 block font-mono text-xs text-white/55"
                      htmlFor={`prompt-${card.id}`}
                    >
                      prompt
                    </label>
                    <input
                      id={`prompt-${card.id}`}
                      value={card.prompt}
                      onChange={(event) =>
                        updateCard(cardIndex, { ...card, prompt: event.target.value })
                      }
                      maxLength={140}
                      placeholder="Name something…"
                      className="mt-2 min-h-12 w-full rounded-lg border border-white/15 bg-white/[0.04] px-4"
                    />
                    <div className="mt-5 space-y-2">
                      {card.answers.map((answer, answerIndex) => (
                        <div
                          key={answerIndex}
                          className="grid grid-cols-[2rem_1fr] gap-2 sm:grid-cols-[2rem_1fr_1fr]"
                        >
                          <span className="pt-3 text-center font-mono text-xs text-white/35">
                            {answerIndex + 1}
                          </span>
                          <input
                            value={answer.label}
                            onChange={(event) => {
                              const answers = card.answers.map((current, index) =>
                                index === answerIndex
                                  ? { ...current, label: event.target.value }
                                  : current,
                              );
                              updateCard(cardIndex, { ...card, answers });
                            }}
                            maxLength={56}
                            aria-label={`Card ${cardIndex + 1}, answer ${answerIndex + 1}`}
                            placeholder="accepted answer"
                            className="min-h-11 rounded-lg border border-white/15 bg-white/[0.04] px-3"
                          />
                          <input
                            value={answer.aliases}
                            onChange={(event) => {
                              const answers = card.answers.map((current, index) =>
                                index === answerIndex
                                  ? { ...current, aliases: event.target.value }
                                  : current,
                              );
                              updateCard(cardIndex, { ...card, answers });
                            }}
                            maxLength={220}
                            aria-label={`Card ${cardIndex + 1}, answer ${answerIndex + 1} aliases`}
                            placeholder="aliases, optional"
                            className="col-start-2 min-h-11 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-white/75 sm:col-start-auto"
                          />
                        </div>
                      ))}
                    </div>
                    {cards.length > 4 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCards((current) => current.filter((_, index) => index !== cardIndex));
                          setOpenCard(Math.max(0, cardIndex - 1));
                        }}
                        className="mt-5 min-h-11 font-mono text-xs text-white/45 hover:text-white"
                      >
                        remove card
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        {cards.length < 80 ? (
          <button
            type="button"
            onClick={() => {
              setCards((current) => [...current, blankCard()]);
              setOpenCard(cards.length);
            }}
            className="mt-5 min-h-12 rounded-full border border-white/20 px-5 font-mono text-xs"
          >
            + add card
          </button>
        ) : null}
        <div className="sticky bottom-0 mt-10 border-t border-white/12 bg-[var(--things-night)] py-5">
          <button
            type="button"
            onClick={save}
            disabled={!valid}
            className="min-h-14 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-semibold text-black disabled:opacity-35"
          >
            save deck
          </button>
          {!valid ? (
            <p className="mt-2 text-center font-mono text-xs text-white/45">
              Complete at least four cards, with ten answers on every card.
            </p>
          ) : null}
          {deck && onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(deck)}
              className="mt-3 min-h-11 w-full font-mono text-xs text-white/45"
            >
              delete this deck
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
